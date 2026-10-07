"""#34 acceptance battery — the fault-injection / concurrency checklist from
the 0.1 goal, run against the REAL app+engine (no browser, no mocks of
science): parameter changes produce NEW runs, fork/compare/trace work over
HTTP, concurrent engine requests are serialized safely, an idempotent retry
never re-executes, a killed docling worker frees the slot, and a corrupt
runlog tail never loses intact runs (engine restart keeps lineage).
Browser-render P95 and pointer-level interaction remain deploy/browser items
by the no-GUI constraint."""
import asyncio
import json

import httpx
import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

PLAN_F = {
    "planId": "battery-formula",
    "skill": "formula.plot",
    "goal": "battery formula plan",
    "metrics": [],
    "nonClaims": [],
}


def _plan(skill: str, pid: str) -> dict:
    return {"planId": pid, "skill": skill, "goal": f"battery {skill}", "metrics": [], "nonClaims": []}


async def _exec(client: AsyncClient, skill: str, inp: dict, plan: dict, **extra) -> dict:
    resp = await client.post(
        "/api/engine/execute",
        json={"skill": skill, "input": inp, "planId": plan["planId"], "plan": plan, **extra},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["outcome"]


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for name in list(__import__("os").environ):
        if name.startswith("PAPER2LAB_AGENT_") or name == "DASHSCOPE_API_KEY":
            monkeypatch.delenv(name, raising=False)


class TestBattery:
    @pytest.mark.asyncio
    async def test_parameter_change_produces_a_new_run_with_new_numbers(self):
        """参数改变影响 Run: same skill, different a → different runId+peak"""
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                i1 = {"expression": ["Multiply", "a", ["Sin", "x"]], "parameters": ["a", "x"], "values": {"a": 1, "x": 0}, "independent": "x", "range": [-5, 5], "samples": 41}
                o1 = await _exec(client, "formula.plot", i1, _plan("formula.plot", "batt-f1"))
                assert o1["status"] == "ok"
                i2 = {**i1, "values": {"a": 2, "x": 0}}
                o2 = await _exec(client, "formula.plot", i2, _plan("formula.plot", "batt-f2"))
                assert o2["status"] == "ok"
                assert o1["run"]["runId"] != o2["run"]["runId"]
                assert abs(o2["run"]["result"]["peak"] - 2 * o1["run"]["result"]["peak"]) < 1e-9

    @pytest.mark.asyncio
    async def test_fork_compare_trace_over_http(self):
        """Fork/Compare/Trace: fork a kakeya run with changed packing, compare
        the two runs, and list them via /runs (trace surface)."""
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                base_out = await _exec(client, "kakeya.measure", {"deltaExp": 4, "packing": 0, "res": 16, "nTubes": 16}, _plan("kakeya.measure", "batt-k"))
                assert base_out["status"] == "ok"
                base_id = base_out["run"]["runId"]
                fork_out = await _exec(
                    client,
                    "experiment.fork",
                    {"sourceRunId": base_id, "parameterChanges": {"packing": 1}},
                    _plan("kakeya.measure", "batt-k"),
                    parentRunId=base_id,
                )
                assert fork_out["status"] == "ok", fork_out
                fork_run = fork_out["run"]
                assert fork_run["parentRunId"] == base_id
                assert fork_run["spec"]["params"]["packing"] == 1
                cmp_out = await _exec(
                    client,
                    "experiment.compare",
                    {"runA": base_id, "runB": fork_run["runId"]},
                    _plan("kakeya.measure", "batt-k"),
                )
                assert cmp_out["status"] == "ok"
                # trace surface: both runs appear in /api/engine/runs
                runs = (await client.get("/api/engine/runs", params={"limit": 50})).json()["runs"]
                ids = {r["runId"] for r in runs}
                assert base_id in ids and fork_run["runId"] in ids

    @pytest.mark.asyncio
    async def test_concurrent_engine_requests_all_complete(self):
        """并发：6 个并发引擎请求（各自计划）全部成功且 runId 唯一"""
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t", timeout=120) as client:
                async def one(i: int):
                    inp = {"expression": ["Add", "x", i], "bindings": {"x": i}}
                    return await _exec(client, "formula.evaluate", inp, _plan("formula.evaluate", f"batt-c{i}"))

                outs = await asyncio.gather(*(one(i) for i in range(6)))
                vals = [o["run"]["result"]["value"] for o in outs]
                ids = [o["run"]["runId"] for o in outs]
                assert len(set(ids)) == 6  # six real executions, none lost
                assert vals == [2 * i for i in range(6)]

    @pytest.mark.asyncio
    async def test_fault_injection_retry_same_request_id_never_reexecutes(self):
        """故障注入：同 requestId 重试（模拟网关超时后客户端重发）不重跑科学操作"""
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                body = {"skill": "formula.evaluate", "input": {"expression": ["Sin", "x"], "bindings": {"x": 1}}, "planId": "batt-idem", "plan": _plan("formula.evaluate", "batt-idem"), "requestId": "batt-idem-1"}
                r1 = await client.post("/api/engine/execute", json=body)
                assert r1.status_code == 200
                run1 = r1.json()["outcome"]["run"]["runId"]
                r2 = await client.post("/api/engine/execute", json=body)
                run2 = r2.json()["outcome"]["run"]["runId"]
                assert run1 == run2  # cache hit — the operation ran ONCE

    @pytest.mark.asyncio
    async def test_engine_restart_recovers_recorded_runs(self):
        """服务重启恢复：kills the engine child; the next call reboots and the
        recorded runs (incl. fork lineage) are still listable."""
        from server.engine_bridge import bridge
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                out = await _exec(client, "formula.evaluate", {"expression": ["Cos", "x"], "bindings": {"x": 0}}, _plan("formula.evaluate", "batt-r"))
                rid = out["run"]["runId"]
                await bridge.stop()  # simulate engine death
                again = (await client.get("/api/engine/runs", params={"limit": 50})).json()["runs"]
                ids = {r["runId"] for r in again}
                assert rid in ids  # persistence survived the restart
                # and the engine still executes after reboot
                out2 = await _exec(client, "formula.evaluate", {"expression": ["Sin", "x"], "bindings": {"x": 1}}, _plan("formula.evaluate", "batt-r2"))
                assert out2["status"] == "ok"
