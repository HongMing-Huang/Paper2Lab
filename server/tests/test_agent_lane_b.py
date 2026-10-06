"""Lane B acceptance — orchestration contract (server/agent*):
  * TEN chained branching turns keep an unbroken parentRunId lineage, each
    turn continuing from the PREVIOUS target run (baseRunId chaining), with
    values actually changing (not silently re-running the first experiment)
  * after a failed turn the session continues on the next turn
  * new resume guards: stale round replay rejected, forged tool name
    rejected, partial batch rejected
"""
from __future__ import annotations

import importlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from asgi_lifespan import LifespanManager  # noqa: E402

FORMULA_BASE = {
    "expression": ["Multiply", "a", ["Sin", "x"]],
    "parameters": ["a", "x"],
    "values": {"a": 1, "x": 0},
    "independent": "x",
    "range": [-7, 7],
    "samples": 121,
}


def _events(text: str) -> list[dict]:
    return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]

async def _post_events(c: httpx.AsyncClient, payload: dict) -> list[dict]:
    r = await c.post("/api/agent/turn", json=payload)
    assert r.status_code == 200
    body = (await r.aread()).decode()  # SSE bodies are async streams under ASGI
    return _events(body)



async def _turn(c: httpx.AsyncClient, sid: str, intent: str, ctx: dict) -> list[dict]:
    events: list[dict] = []
    async with c.stream(
        "POST", "/api/agent/turn",
        json={"sessionId": sid, "intent": intent, "context": ctx},
    ) as r:
        assert r.status_code == 200
        async for line in r.aiter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


@pytest.mark.asyncio
async def test_ten_round_branch_lineage_via_baseRunId() -> None:
    """the acceptance: 10 consecutive branching turns, each forked from the
    previous turn's target run — lineage unbroken, peak keeps doubling."""
    async with LifespanManager(_app()) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as c:
            sid = "lane-b-ten"
            ctx: dict = {"deskKind": "formula", "execution": "server", "params": ["a"], "base": FORMULA_BASE}
            target = None
            peaks = []
            for turn in range(10):
                events = await _turn(c, sid, "把 a 加倍", ctx)
                done = next(e for e in events if e["type"] == "done")
                assert done["reason"] == "completed", f"turn {turn}: {done}"
                new_target = done.get("targetRunId")
                assert new_target, f"turn {turn}: done carries no targetRunId"
                if target is not None:
                    assert new_target != target, "consecutive turns must not reuse the same run"
                target = new_target
                run = next(e for e in events if e["type"] == "experiment_completed")
                peaks.append(run["metrics"]["peak"])
                # CHAIN: next turn's base is this turn's target (the fix —
                # previously every turn re-forked the ORIGINAL first run)
                ctx = {"deskKind": "formula", "execution": "server", "params": ["a"], "baseRunId": target}
            # peak doubles per turn (a: 1 → 1024) — proves each turn really
            # continued from the latest run, not the first
            for i in range(1, len(peaks)):
                assert peaks[i] == pytest.approx(peaks[0] * (2 ** i), abs=2e-3 * peaks[0] * (2 ** i)), peaks


@pytest.mark.asyncio
async def test_failure_then_continue() -> None:
    async with LifespanManager(_app()) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as c:
            sid = "lane-b-fail"
            # a baseRunId that cannot exist → explicit failure
            bad = await _turn(c, sid, "把 a 加倍", {"deskKind": "formula", "execution": "server", "baseRunId": "no-such-run"})
            assert bad[-1]["type"] == "done" and bad[-1]["reason"] == "execution_failed"
            # the session still works on the NEXT turn
            ok = await _turn(c, sid, "把 a 加倍", {"deskKind": "formula", "execution": "server", "params": ["a"], "base": FORMULA_BASE})
            assert ok[-1]["reason"] == "completed"
            assert ok[-1].get("targetRunId")


@pytest.mark.asyncio
async def test_restart_recovery_round_token_survives() -> None:
    """restart (module reload over the same DATA_DIR) — the paused round's
    nonce persists; a resume WITHOUT the round id is rejected, WITH it works."""
    data = tempfile.mkdtemp(prefix="p2l-laneb2-")
    os.environ["PAPER2LAB_DATA_DIR"] = data
    try:
        import server.agent as agent_mod

        importlib.reload(agent_mod)
        app = _reload_app()
        async with LifespanManager(app) as mgr:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as c:
                sid = "lane-b-restart"
                # browser mode: issue a pause
                events = await _turn(c, sid, "a 设为 2", {"deskKind": "formula", "params": ["a"]})
                req = next(e for e in events if e["type"] == "require_execution")
                # --- server "restart": reload the agent module (sessions reload from disk)
                importlib.reload(agent_mod)
                # missing roundId → rejected
                ev1 = await _post_events(c, {"sessionId": sid, "intent": "", "context": {}, "resume": {
                    "executionResults": [{"toolCallId": req["toolCallId"], "tool": "scientific_execute", "status": "ok", "result": {"runs": []}}],
                }})
                assert "round mismatch" in ev1[0].get("message", "")
                # with the roundId → accepted
                ev2 = await _post_events(c, {"sessionId": sid, "intent": "", "context": {}, "resume": {
                    "roundId": req["roundId"],
                    "executionResults": [{"toolCallId": req["toolCallId"], "tool": "scientific_execute", "status": "ok", "result": {"runs": [{"runId": "r-after-restart", "metrics": {}}]}}],
                }})
                kinds = [e["type"] for e in ev2]
                assert "experiment_completed" in kinds and "done" in kinds
    finally:
        os.environ.pop("PAPER2LAB_DATA_DIR", None)
        shutil.rmtree(data, ignore_errors=True)


@pytest.mark.asyncio
async def test_resume_guards_round_tool_batch() -> None:
    async with LifespanManager(_app()) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as c:
            sid = "lane-b-guards"
            events = await _turn(c, sid, "a 设为 2", {"deskKind": "formula", "params": ["a"]})
            req = next(e for e in events if e["type"] == "require_execution")

            # forged TOOL name
            ev = await _post_events(c, {"sessionId": sid, "intent": "", "context": {}, "resume": {
                "roundId": req["roundId"],
                "executionResults": [{"toolCallId": req["toolCallId"], "tool": "backdoor.wipe", "status": "ok", "result": {}}],
            }})
            assert "never registers" in ev[0].get("message", "")

            # stale round nonce (right id, wrong round)
            ev = await _post_events(c, {"sessionId": sid, "intent": "", "context": {}, "resume": {
                "roundId": "round-stale",
                "executionResults": [{"toolCallId": req["toolCallId"], "tool": "scientific_execute", "status": "ok", "result": {"runs": []}}],
            }})
            assert "round mismatch" in ev[0].get("message", "")

            # extra row from an unrelated id = batch completeness violation
            ev = await _post_events(c, {"sessionId": sid, "intent": "", "context": {}, "resume": {
                "roundId": req["roundId"],
                "executionResults": [
                    {"toolCallId": req["toolCallId"], "tool": "scientific_execute", "status": "ok", "result": {"runs": []}},
                    {"toolCallId": "tc-extra", "tool": "scientific_execute", "status": "ok", "result": {"runs": []}},
                ],
            }})
            assert "never issued" in ev[0].get("message", "") or "batch" in ev[0].get("message", "")


def _app():
    from server.main import app

    return app


def _reload_app():
    import importlib

    import server.main as main_mod

    importlib.reload(main_mod)
    return main_mod.app
