"""Agent plays the challenges — server-execution mode turns where the AGENT
attempts the SAME level, same constraints, same budget accounting as a user
would (the challenge kernel is shared; only the actor differs)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from asgi_lifespan import LifespanManager  # noqa: E402
from server.main import app  # noqa: E402


def _events(text: str) -> list[dict]:
    return [json.loads(l[6:]) for l in text.splitlines() if l.startswith("data: ")]


async def _turn(c: httpx.AsyncClient, sid: str, intent: str, ctx: dict) -> list[dict]:
    events: list[dict] = []
    async with c.stream("POST", "/api/agent/turn", json={"sessionId": sid, "intent": intent, "context": ctx}) as r:
        assert r.status_code == 200
        async for line in r.aiter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


@pytest.mark.asyncio
async def test_agent_hits_projectile_target() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as c:
            events = await _turn(c, "ch-proj", "把角度设为 45 力度设为 15 试一次", {
                "deskKind": "challenge",
                "execution": "server",
                "base": {"challenge": "projectile", "changes": {"angleDeg": 30, "speed": 10}},
            })
            types = [e["type"] for e in events]
            assert types[-1] == "done" and events[-1]["reason"] == "completed", types
            run = next(e for e in events if e["type"] == "experiment_completed")
            assert run["runId"].startswith("challenge-attempt-")
            assert run["metrics"]["score"] > 1000  # hit bonus — real compute
            assert run["metrics"]["error"] < 0.5


@pytest.mark.asyncio
async def test_agent_retry_improves_pendulum() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as c:
            # wrong length first (measured period ~1.43, mismatch)
            e1 = await _turn(c, "ch-pend", "把杆长设为 0.5 试一次", {
                "deskKind": "challenge", "execution": "server",
                "base": {"challenge": "pendulum", "changes": {"length": 0.6}},
            })
            r1 = next(e for e in e1 if e["type"] == "experiment_completed")
            assert r1["metrics"]["measuredPeriod"] == pytest.approx(1.43, abs=0.05)
            # retry with the matching length (real feedback → adjust → retry)
            e2 = await _turn(c, "ch-pend", "把杆长设为 0.994 试一次", {
                "deskKind": "challenge", "execution": "server",
                "base": {"challenge": "pendulum", "changes": {"length": 0.6}},
            })
            r2 = next(e for e in e2 if e["type"] == "experiment_completed")
            assert r2["metrics"]["measuredPeriod"] == pytest.approx(2.0, abs=0.05)
            assert r2["metrics"]["score"] > r1["metrics"]["score"]  # retry improved


@pytest.mark.asyncio
async def test_agent_tubes_attempt_scores_real_volume() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as c:
            events = await _turn(c, "ch-tubes", "试一次", {
                "deskKind": "challenge", "execution": "server",
                # honest winning configuration (#21): half-packing beats the
                # 0.28 budget (0.2704); all-1 full-sticky (0.2905) now scores 0
                "base": {"challenge": "tubes", "changes": {"offsets": [0.5, 0.5, 0.5, 0.5]}},
            })
            run = next(e for e in events if e["type"] == "experiment_completed")
            assert 0 < run["metrics"]["occupiedVolume"] < 0.28
            assert run["metrics"]["score"] > 0


@pytest.mark.asyncio
async def test_challenge_refuses_browser_mode() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as c:
            events = await _turn(c, "ch-browser", "试一次", {"deskKind": "challenge"})
            assert events[-1]["type"] == "done"
            assert events[-1]["reason"] == "not-an-experiment"
