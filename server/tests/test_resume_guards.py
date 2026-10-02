"""Blocker-3 regressions:
  A. the server accepted tool results for calls it NEVER issued (forged or
     cross-session toolCallIds passed validation) — now every resumed id must
     be in the session's issued_calls set.
  B. client-side failure feedback is covered by TS tests (agentBridge resumes
     with status:'error'); the server side must translate that into
     experiment_failed — already tested, re-pinned here for the pair.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from asgi_lifespan import LifespanManager  # noqa: E402

from server.main import app  # noqa: E402


async def _client() -> httpx.AsyncClient:
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


async def _issue(session_id: str, client: httpx.AsyncClient) -> dict:
    r = await client.post(
        "/api/agent/turn",
        json={"sessionId": session_id, "intent": "a 设为 2", "context": {"deskKind": "formula", "params": ["a"]}},
    )
    return next(e for e in _events(r.text) if e["type"] == "require_execution")


async def test_resume_with_never_issued_tool_call_id_is_rejected():
    async with await _client() as c:
        # session A issues a real call
        req_a = await _issue("guard-a", c)
        # session B issues its own call
        req_b = await _issue("guard-b", c)
        # session A tries to answer session B's call id (cross-session replay)
        r = await c.post(
            "/api/agent/turn",
            json={
                "sessionId": "guard-a",
                "intent": "",
                "context": {},
                "resume": {
                    "executionResults": [
                        {"toolCallId": req_b["toolCallId"], "tool": "scientific_execute", "status": "ok", "result": {"runs": []}}
                    ]
                },
            },
        )
        kinds = [e["type"] for e in _events(r.text)]
        assert "error" in kinds
        assert "done" not in kinds
        assert "experiment_completed" not in kinds


async def test_resume_with_forged_unknown_tool_call_id_is_rejected():
    async with await _client() as c:
        await _issue("guard-forged", c)
        r = await c.post(
            "/api/agent/turn",
            json={
                "sessionId": "guard-forged",
                "intent": "",
                "context": {},
                "resume": {
                    "executionResults": [
                        {"toolCallId": "tc-does-not-exist", "tool": "scientific_execute", "status": "ok", "result": {"runs": [{"runId": "forged"}]}}
                    ]
                },
            },
        )
        kinds = [e["type"] for e in _events(r.text)]
        assert "error" in kinds
        assert "experiment_completed" not in kinds


async def test_legitimately_issued_call_still_round_trips():
    async with await _client() as c:
        req = await _issue("guard-ok", c)
        r = await c.post(
            "/api/agent/turn",
            json={
                "sessionId": "guard-ok",
                "intent": "",
                "context": {},
                "resume": {
                    "executionResults": [
                        {"toolCallId": req["toolCallId"], "tool": "scientific_execute", "status": "ok", "result": {"runs": [{"runId": "r-ok", "metrics": {}}]}}
                    ]
                },
            },
        )
        kinds = [e["type"] for e in _events(r.text)]
        assert "experiment_completed" in kinds
        assert "done" in kinds


async def test_error_status_resume_yields_experiment_failed():
    async with await _client() as c:
        req = await _issue("guard-err", c)
        r = await c.post(
            "/api/agent/turn",
            json={
                "sessionId": "guard-err",
                "intent": "",
                "context": {},
                "resume": {
                    "executionResults": [
                        {"toolCallId": req["toolCallId"], "tool": "scientific_execute", "status": "error", "error": "compile failed"}
                    ]
                },
            },
        )
        kinds = [e["type"] for e in _events(r.text)]
        assert "experiment_failed" in kinds
        assert "observation_ready" not in kinds
        done = next(e for e in _events(r.text) if e["type"] == "done")
        assert done["reason"] == "execution_failed"
