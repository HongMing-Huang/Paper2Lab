"""v0.3 agent foundation: server-execution mode — an agent turn completes
HEADLESS by running its plan steps through the engine bridge (the SAME
unified executor the browser runs). Covers all four compute desks
(formula / kakeya / ode / geometry) plus the guards.
"""
from __future__ import annotations

import json
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
    reason="server execution needs the engine bridge (node + tsx)",
)

FORMULA_BASE = {
    "expression": ["Multiply", "a", ["Sin", "x"]],
    "parameters": ["a", "x"],
    "values": {"a": 1, "x": 0},
    "independent": "x",
    "range": [-7, 7],
    "samples": 161,
}
KAKEYA_BASE = {"deltaExp": 4, "packing": 0, "res": 24, "nTubes": 32}
ODE_BASE = {
    "system": {"kind": "lv2", "params": {"alpha": 1.1, "beta": 0.4, "gamma": 0.4, "delta": 0.1}},
    "initialValues": {"prey": 1, "predator": 0.5},
    "tSpan": [0, 5],
}
GEOMETRY_BASE = {"construction": "perron-tree", "params": {"k": 2, "alpha": 0.7}}


async def _turn(client: httpx.AsyncClient, intent: str, context: dict) -> list[dict]:
    return await _turn_with_resume(client, {"sessionId": "t-server-mode", "intent": intent, "context": context})


async def _turn_with_resume(client: httpx.AsyncClient, body: dict) -> list[dict]:
    events: list[dict] = []
    async with client.stream("POST", "/api/agent/turn", json=body) as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


@pytest.mark.asyncio
async def test_formula_turn_completes_server_side() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            events = await _turn(client, "把 a 翻倍会怎样？", {"deskKind": "formula", "execution": "server", "params": ["a"], "base": FORMULA_BASE})
            types = [e["type"] for e in events]
            assert "plan_created" in types
            assert "require_execution" not in types  # the turn never pauses for a browser
            assert "experiment_completed" in types
            assert "comparison_created" in types
            assert types[-1] == "done" and events[-1]["reason"] == "completed"
            run = next(e for e in events if e["type"] == "experiment_completed")
            assert run["runId"].startswith("formula-curve-")
            assert run["metrics"]["peak"] == pytest.approx(2.0, abs=1e-3)  # a=2 ⇒ peak ≈ |a|
            cmp_evt = next(e for e in events if e["type"] == "comparison_created")
            assert cmp_evt["comparison"]["runA"] != cmp_evt["comparison"]["runB"]


@pytest.mark.asyncio
async def test_kakeya_turn_completes_server_side() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            events = await _turn(client, "方向数减少一半呢？", {"deskKind": "kakeya", "execution": "server", "base": KAKEYA_BASE})
            types = [e["type"] for e in events]
            assert types[-1] == "done" and events[-1]["reason"] == "completed"
            run = next(e for e in events if e["type"] == "experiment_completed")
            assert run["runId"].startswith("kakeya-voxel-")
            assert 0 < run["metrics"]["occupiedVolume"] < 1


@pytest.mark.asyncio
async def test_ode_turn_completes_server_side() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            events = await _turn(client, "把 alpha 加倍试试", {"deskKind": "ode", "execution": "server", "params": ["alpha"], "base": ODE_BASE})
            types = [e["type"] for e in events]
            assert types[-1] == "done" and events[-1]["reason"] == "completed"
            run = next(e for e in events if e["type"] == "experiment_completed")
            assert run["runId"].startswith("lv-ode-")
            assert run["metrics"]["conservedDrift"] < 1e-3  # LV conservation holds on the fork
            assert "finalPrey" in run["metrics"]


@pytest.mark.asyncio
async def test_geometry_turn_completes_server_side() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            events = await _turn(client, "把重叠比 α 设为 0.9", {"deskKind": "geometry", "execution": "server", "base": GEOMETRY_BASE})
            types = [e["type"] for e in events]
            assert types[-1] == "done" and events[-1]["reason"] == "completed"
            run = next(e for e in events if e["type"] == "experiment_completed")
            assert run["runId"].startswith("perron-tree-")
            assert run["metrics"]["computedArea"] > 0


@pytest.mark.asyncio
async def test_server_mode_guards() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            # no base experiment → explicit failure, not a silent nothing
            events = await _turn(client, "把 a 翻倍", {"deskKind": "formula", "execution": "server"})
            types = [e["type"] for e in events]
            assert "error" in types and types[-1] == "done"
            assert events[-1]["reason"] == "execution_failed"

            # ode desk WITHOUT server mode has no browser execution surface —
            # the server refuses to promise a turn that could never complete
            events = await _turn(client, "把 alpha 加倍", {"deskKind": "ode"})
            assert events[-1]["type"] == "done" and events[-1]["reason"] == "not-an-experiment"

            # server-execution turns have no resume contract
            events = await _turn_with_resume(
                client,
                {"sessionId": "t-server-mode", "intent": "把 a 翻倍", "context": {"deskKind": "formula", "execution": "server", "base": FORMULA_BASE}, "resume": {"executionResults": []}},
            )
            assert any(e["type"] == "error" and "resume" in e.get("message", "") for e in events)
