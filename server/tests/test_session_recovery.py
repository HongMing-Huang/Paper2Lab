"""M6: agent session persistence — answered/issued toolCallIds and history
survive a server restart (importlib.reload over the same DATA_DIR), so
duplicate-resume and issued-guard enforcement hold across restarts, and a
multi-turn session continues on its recorded branch context.
"""
from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_DATA = Path(tempfile.mkdtemp(prefix="p2l-agent-sessions-"))
os.environ["PAPER2LAB_DATA_DIR"] = str(_DATA)
os.environ.pop("DASHSCOPE_API_KEY", None)

from asgi_lifespan import LifespanManager  # noqa: E402


def _client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _events(text: str) -> list[dict]:
    out = []
    for line in text.splitlines():
        if line.startswith("data: "):
            try:
                out.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass
    return out


async def test_session_state_survives_restart_and_guards_still_enforced():
    import server.main as main_mod

    importlib.reload(main_mod)  # instance 1
    async with _client(main_mod.app) as c:
        r = await c.post(
            "/api/agent/turn",
            json={"sessionId": "persist-1", "intent": "a 设为 2", "context": {"deskKind": "formula", "params": ["a"]}},
        )
        req = next(e for e in _events(r.text) if e["type"] == "require_execution")
        # answer it — this persists answered+issued state
        r2 = await c.post(
            "/api/agent/turn",
            json={
                "sessionId": "persist-1",
                "intent": "",
                "context": {},
                "resume": {
                    "executionResults": [
                        {"toolCallId": req["toolCallId"], "tool": "scientific_execute", "status": "ok", "result": {"runs": []}}
                    ]
                },
            },
        )
        assert "done" in [e["type"] for e in _events(r2.text)]

    assert (_DATA / "agent-session-persist-1.json").is_file(), "session must be persisted to disk"

    importlib.reload(main_mod)  # instance 2 = restart
    import server.agent as agent_mod

    assert "persist-1" in agent_mod._sop_sessions, "session reloaded from disk on import"
    async with _client(main_mod.app) as c:
        # duplicate resume of the ALREADY-answered call is still rejected post-restart
        r3 = await c.post(
            "/api/agent/turn",
            json={
                "sessionId": "persist-1",
                "intent": "",
                "context": {},
                "resume": {
                    "executionResults": [
                        {"toolCallId": req["toolCallId"], "tool": "scientific_execute", "status": "ok", "result": {"runs": []}}
                    ]
                },
            },
        )
        kinds = [e["type"] for e in _events(r3.text)]
        assert "error" in kinds and "done" not in kinds
        # and a NEW turn in the same session continues (round counter persisted)
        r4 = await c.post(
            "/api/agent/turn",
            json={"sessionId": "persist-1", "intent": "再对比一次", "context": {"deskKind": "formula", "params": ["a"]}},
        )
        kinds4 = [e["type"] for e in _events(r4.text)]
        assert "plan_created" in kinds4  # compare-only plan → still answers


async def test_multi_turn_branch_continuity_via_recorded_history():
    """turn 1 forks (b×2); turn 2 references the branch and halves — the
    session's recorded history carries the branch run id between turns."""
    import server.main as main_mod

    importlib.reload(main_mod)
    async with _client(main_mod.app) as c:
        # turn 1: scale b ×2 on the base
        r1 = await c.post(
            "/api/agent/turn",
            json={"sessionId": "multi-1", "intent": "把 b 增大一倍", "context": {"deskKind": "formula", "params": ["a", "b"], "selectedRunId": "run-base"}},
        )
        req1 = next(e for e in _events(r1.text) if e["type"] == "require_execution")
        assert req1["args"]["steps"][0]["op"] == "experiment.fork"
        fork_run = "formula-curve-fork-b2"
        await c.post(
            "/api/agent/turn",
            json={
                "sessionId": "multi-1",
                "intent": "",
                "context": {},
                "resume": {
                    "executionResults": [
                        {"toolCallId": req1["toolCallId"], "tool": "scientific_execute", "status": "ok", "result": {"runs": [{"runId": fork_run, "metrics": {"peak": 2}}]}}
                    ]
                },
            },
        )
        # turn 2 on the SAME session: operates the branch recorded in context
        r2 = await c.post(
            "/api/agent/turn",
            json={"sessionId": "multi-1", "intent": "在这个分支上把 a 减半", "context": {"deskKind": "formula", "params": ["a", "b"], "selectedRunId": fork_run}},
        )
        req2 = next(e for e in _events(r2.text) if e["type"] == "require_execution")
        steps2 = req2["args"]["steps"]
        assert steps2[0]["op"] == "experiment.fork"
        assert any(s["op"] == "formula.scale" and s["param"] == "a" and s["value"] == 0.5 for s in steps2)

        # session history now records both turns
        import server.agent as agent_mod

        s = agent_mod._sop_sessions["multi-1"]
        intents = [h.get("intent") for h in s.history if "intent" in h]
        assert intents == ["把 b 增大一倍", "在这个分支上把 a 减半"]
        assert len(s.answered_calls) >= 1
