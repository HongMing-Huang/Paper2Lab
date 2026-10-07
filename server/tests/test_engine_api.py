"""0.2 backend engine chain: the FastAPI app drives the SAME unified executor
the browser runs, via the long-lived Node bridge. These tests execute REAL
kernels (formula/ode/kakeya) — no mocks — and check the PlayPlan gate, the
registry surface, run history, and the high-scale C++ precompute bundle.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from asgi_lifespan import LifespanManager  # noqa: E402
from server.main import app  # noqa: E402

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not (ROOT / "node_modules" / ".bin" / "tsx").exists(),
    reason="engine bridge needs node + tsx installed",
)


async def _execute(client: httpx.AsyncClient, payload: dict) -> dict:
    resp = await client.post("/api/engine/execute", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()["outcome"]


@pytest.mark.asyncio
def _with_plan(skill: str, payload: dict) -> dict:
    """#32: bare planIds no longer pass — attach a full (registered) plan"""
    payload.setdefault("planId", f"plan-py-{skill.replace('.', '-')}")
    payload["plan"] = {
        "planId": payload["planId"],
        "skill": skill,
        "goal": f"pytest plan for {skill}",
        "metrics": [],
        "nonClaims": ["有限尺度数值实验，不构成证明"],
    }
    return payload


async def test_engine_executes_real_formula_kernel() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            out = await _execute(
                client,
                _with_plan("formula.evaluate", {
                    "skill": "formula.evaluate",
                    "input": {"expression": ["Sin", "x"], "bindings": {"x": 1}},
                    "planId": "plan-engine-test",
                }),
            )
            assert out["status"] == "ok"
            run = out["run"]
            assert run["spec"]["kind"] == "formula.value"
            assert abs(run["result"]["value"] - 0.8414709848078965) < 1e-12  # sin(1), really computed


@pytest.mark.asyncio
async def test_engine_executes_ode_and_kakeya_kernels() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            ode = await _execute(
                client,
                _with_plan("ode.solve", {
                    "skill": "ode.solve",
                    "input": {
                        "system": {"kind": "lv2", "params": {"alpha": 1.1, "beta": 0.4, "gamma": 0.4, "delta": 0.1}},
                        "initialValues": {"prey": 1, "predator": 0.5},
                        "tSpan": [0, 5],
                    },
                    "planId": "plan-engine-ode",
                }),
            )
            assert ode["status"] == "ok"
            assert ode["run"]["spec"]["kind"] == "lv.ode"

            kk = await _execute(
                client,
                _with_plan("kakeya.measure", {
                    "skill": "kakeya.measure",
                    "input": {"deltaExp": 4, "packing": 0, "res": 32, "nTubes": 32},
                    "planId": "plan-engine-kk",
                }),
            )
            assert kk["status"] == "ok"
            assert 0 < kk["run"]["result"]["occupiedVolume"] < 1


@pytest.mark.asyncio
async def test_engine_executes_mujoco_physics() -> None:
    """the wasm physics kernel runs INSIDE the engine child process — real
    mj_step numbers come back inside an ExperimentRun (scene provenance kept)"""
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            out = await _execute(
                client,
                _with_plan("mujoco.simulate", {
                    "skill": "mujoco.simulate",
                    "input": {"scene": "simple.xml", "steps": 100, "sampleEvery": 50, "params": {"gravityZ": -1.62}},
                    "planId": "plan-mujoco",
                }),
            )
            assert out["status"] == "ok", out
            run = out["run"]
            assert run["spec"]["kind"] == "mujoco.sim"
            assert run["engine"] == "mujoco-wasm"
            assert run["engineVersion"] == "3.12.0"
            assert run["spec"]["params"]["gravityZ"] == -1.62
            assert run["spec"]["model"]["scene"] == "simple.xml"
            assert len(run["spec"]["model"]["scenesChecksum"]) == 16
            m = run["result"]["metrics"]
            assert m["allFinite"] is True
            assert m["finalTime"] == pytest.approx(0.2, abs=1e-6)  # 100 × timestep 0.002
            assert m["qposNormFinal"] > 0


@pytest.mark.asyncio
async def test_engine_playplan_gate_applies_headless() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            out = await _execute(client, {"skill": "geometry.2d", "input": {"construction": "perron-tree", "params": {"k": 2, "alpha": 0.7}}})
            assert out["status"] == "needs_input"  # no planId → refused, same as the page


@pytest.mark.asyncio
async def test_engine_rejects_unknown_skill_and_bad_input() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            resp = await client.post("/api/engine/execute", json=_with_plan("formula.plot", {"skill": "formula.plot", "input": {"samples": 1}}))
            assert resp.status_code == 200
            assert resp.json()["outcome"]["status"] == "error"

            unknown = await _execute(client, {"skill": "backdoor.exec", "input": {}})
            assert unknown["status"] == "error"  # unregistered names never execute
            assert "unknown" in unknown.get("message", unknown.get("code", "")).lower()


@pytest.mark.asyncio
async def test_engine_skills_registry_surface() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            resp = await client.get("/api/engine/skills")
            assert resp.status_code == 200
            names = {s["name"] for s in resp.json()["skills"]}
            # the numeric backbone is exposed; UI-only skills are not (executor whitelist)
            assert {"formula.evaluate", "formula.plot", "geometry.2d", "ode.solve", "kakeya.measure"} <= names


@pytest.mark.asyncio
async def test_engine_run_history_lists_recorded_runs() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            await _execute(client, _with_plan("formula.evaluate", {"skill": "formula.evaluate", "input": {"expression": ["Cos", "x"], "bindings": {"x": 0}}}))
            resp = await client.get("/api/engine/runs", params={"limit": 10})
            assert resp.status_code == 200
            runs = resp.json()["runs"]
            assert any(r["spec"]["kind"] == "formula.value" for r in runs)


@pytest.mark.asyncio
async def test_precomputed_high_scale_bundle_served() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            resp = await client.get("/api/engine/kakeya/precomputed")
            assert resp.status_code == 200
            body = resp.json()
            assert body["meta"]["algorithmVersion"] == "kakeya-voxel-v3-cpp"
            assert len(body["meta"]["checksumFnv1a"]) == 16
            runs = body["runs"]
            assert len(runs) >= 63
            assert max(r["spec"]["res"] for r in runs) >= 1024  # billion-voxel tier present
            assert all(r["engine"] == "cpp-precompute" for r in runs)
            ids = [r["runId"] for r in runs]
            assert len(set(ids)) == len(ids)  # stable, unique
            # extreme tier invariants: packing=1 rows have maxMultiplicity == N
            for r in runs:
                p = r["spec"]["params"]
                if p["deltaExp"] == 10 and p["packing"] == 1:
                    assert r["result"]["maxMultiplicity"] == p["nTubes"]


@pytest.mark.asyncio
async def test_ready_reports_engine() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            # touch the engine so it boots, then readiness must see it alive
            await client.get("/api/engine/skills")
            resp = await client.get("/api/ready")
            checks = resp.json()["checks"]
            assert checks["engine"]["ok"] is True
            assert checks["engine"]["booted"] is True


# ---- #31: requestId idempotency + boot-retry hardening -----------------------

import asyncio  # noqa: E402

import server.engine_api as ea  # noqa: E402
from server.engine_bridge import EngineBridge  # noqa: E402


class _FakeProc:
    pid = 424242
    stdin = None

    def poll(self):
        return None


def _rid_req(rid):
    return ea.ExecuteRequest(skill="formula.evaluate", input={}, requestId=rid)


@pytest.mark.asyncio
async def test_request_id_dedupes_inflight_and_caches_outcome(monkeypatch) -> None:
    ea._exec_tasks.clear()
    calls = []

    async def slow_raw(req):
        calls.append(req.requestId)
        await asyncio.sleep(0.2)
        return {"outcome": {"status": "ok", "marker": req.requestId}}

    monkeypatch.setattr(ea, "_execute_raw", slow_raw)
    # in-flight duplicate: both callers join ONE execution
    first, second = await asyncio.gather(ea.execute(_rid_req("dup-1")), ea.execute(_rid_req("dup-1")))
    assert len(calls) == 1
    assert "dup-1" in repr(first)
    assert "dup-1" in repr(second)
    # completed duplicate: cache hit, no second execution
    await ea.execute(_rid_req("dup-1"))
    assert len(calls) == 1
    ea._exec_tasks.clear()


@pytest.mark.asyncio
async def test_request_id_failure_is_cached_not_rerun(monkeypatch) -> None:
    ea._exec_tasks.clear()
    calls = []

    async def failing_raw(req):
        calls.append(req.requestId)
        raise RuntimeError("simulated engine failure (idempotency test)")

    monkeypatch.setattr(ea, "_execute_raw", failing_raw)
    with pytest.raises(RuntimeError):
        await ea.execute(_rid_req("dup-fail"))
    with pytest.raises(RuntimeError):
        await ea.execute(_rid_req("dup-fail"))
    assert len(calls) == 1  # the retry did NOT re-run the scientific operation
    ea._exec_tasks.clear()


@pytest.mark.asyncio
async def test_boot_retry_replaces_a_wedged_first_child(monkeypatch) -> None:
    bridge = EngineBridge()
    counters = {"child": 0, "ping": 0}

    async def fake_child(self):
        counters["child"] += 1
        self._proc = _FakeProc()

    async def flaky_roundtrip(self, request, timeout):
        counters["ping"] += 1
        if counters["ping"] == 1:
            raise asyncio.TimeoutError()  # first child wedged (reproduced class)
        return {"ok": True, "id": 1}

    monkeypatch.setattr(EngineBridge, "_boot_child", fake_child)
    monkeypatch.setattr(EngineBridge, "_roundtrip", flaky_roundtrip)
    await bridge._boot()  # second attempt boots; no 180s burn
    assert counters["child"] == 2
    assert counters["ping"] == 2
    bridge._teardown_proc()


@pytest.mark.asyncio
async def test_boot_double_wedge_fails_fast(monkeypatch) -> None:
    bridge = EngineBridge()

    async def fake_child(self):
        self._proc = _FakeProc()

    async def dead_roundtrip(self, request, timeout):
        raise asyncio.TimeoutError()

    monkeypatch.setattr(EngineBridge, "_boot_child", fake_child)
    monkeypatch.setattr(EngineBridge, "_roundtrip", dead_roundtrip)
    with pytest.raises(RuntimeError):
        await bridge._boot()  # surfaces after 2×10s, not BOOT_TIMEOUT_S
    bridge._teardown_proc()
