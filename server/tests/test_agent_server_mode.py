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
MUJOCO_BASE = {"scene": "simple.xml", "steps": 200, "sampleEvery": 100, "params": {"gravityZ": -9.81}}


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
async def test_mujoco_turn_completes_server_side() -> None:
    """physics desk: gravity doubling runs REAL MuJoCo wasm physics in the
    engine child process and streams the resulting ExperimentRun back."""
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            events = await _turn(client, "把重力加倍试试", {"deskKind": "mujoco", "execution": "server", "params": ["gravityZ"], "base": MUJOCO_BASE})
            types = [e["type"] for e in events]
            assert types[-1] == "done" and events[-1]["reason"] == "completed"
            assert "require_execution" not in types
            run = next(e for e in events if e["type"] == "experiment_completed")
            assert run["runId"].startswith("mujoco-sim-")
            assert run["metrics"]["finalTime"] == pytest.approx(0.4, abs=1e-6)  # 200 × timestep 0.002
            assert run["metrics"]["qposNormFinal"] > 0
            cmp_evt = next(e for e in events if e["type"] == "comparison_created")
            assert cmp_evt["comparison"]["runA"] != cmp_evt["comparison"]["runB"]


MODEL_BASE = {
    # the MM paper's own model (ode-michaelis-menten fixture): 4 states,
    # greek rates, PAPER-stated initials — the agent may tune rates only
    "states": ["S", "C", "E", "P"],
    "rhs": {
        "S": "-\\kappa S E + \\lambda C",
        "C": "\\kappa S E - \\lambda C - \\mu C",
        "E": "-\\kappa S E + \\lambda C + \\mu C",
        "P": "\\mu C",
    },
    "params": {"kappa": 1, "lambda": 0.2, "mu": 0.4},
    "initialState": {"S": 1, "C": 0, "E": 0.1, "P": 0},
    "tSpan": [0, 30],
}


@pytest.mark.asyncio
async def test_model_turn_completes_server_side() -> None:
    """#51 P0-C model desk: μ doubling runs the N-state RK4 in the engine,
    forks keep the paper's initials, and the turn emits an execution receipt."""
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            events = await _turn(client, "把 μ 加倍试试", {"deskKind": "model", "execution": "server", "params": ["kappa", "lambda", "mu"], "base": MODEL_BASE})
            types = [e["type"] for e in events]
            assert types[-1] == "done" and events[-1]["reason"] == "completed"
            assert "require_execution" not in types
            run = next(e for e in events if e["type"] == "experiment_completed")
            assert run["runId"].startswith("model-solved-")
            # μ×2 ⇒ faster catalysis ⇒ less substrate left at t=30
            assert 0 < run["metrics"]["final_S"] < 0.75
            assert run["metrics"]["final_P"] > 0.25
            # #51 P0-C: the execution receipt is present and auditable
            receipt = next(e for e in events if e["type"] == "execution_receipt")
            r = receipt["receipt"]
            assert r["desk"] == "model"
            assert r["runIds"], "receipt must list the real run ids"
            assert r["checks"]["allRunsReal"] is True
            assert "加倍" in r["goal"] or r["goal"]  # goal carries the intent
            assert any(s.get("param") == "mu" for s in r["steps"] if isinstance(s, dict))
            cmp_evt = next(e for e in events if e["type"] == "comparison_created")
            assert cmp_evt["comparison"]["runA"] != cmp_evt["comparison"]["runB"]


@pytest.mark.asyncio
async def test_structured_context_carries_claims_and_quantities() -> None:
    """#51 P0-C: the agent context is STRUCTURED — claims with anchor
    precision and quantity roles enter as labeled fields, not one truncated
    string; the model sees which quantities are tunable parameters."""
    from server.agent import _build_context_message

    ctx = {
        "paper": {"title": "SIR", "question": "threshold behaviour"},
        "spec": {
            "claims": [
                {"statement": "the sum S+I+R stays constant", "anchorPrecision": "region"},
                {"statement": "the outbreak burns out", "anchorPrecision": "ambiguous"},
            ],
            "quantities": [
                {"name": "S", "role": "state", "nominal": 0.99},
                {"name": "beta", "role": "parameter", "nominal": 0.4},
            ],
            "states": ["S", "I", "R"],
        },
    }
    msg = _build_context_message("如果 β 增大？", ctx)
    assert "Paper claims" in msg and "stays constant" in msg
    assert "[region]" in msg and "[ambiguous]" in msg  # precision is labeled
    assert "Paper quantities" in msg
    assert "beta (parameter) = 0.4" in msg  # roles + nominals, machine-shaped
    assert "Model states: S, I, R" in msg
    assert "only PARAMS are tunable" in msg


@pytest.mark.asyncio
async def test_model_intent_uses_greek_alias_target() -> None:
    """μ (or µ) in the user text resolves to the spec param 'mu'."""
    from server.agent import _parse_model_intent

    steps = _parse_model_intent("把 μ 减半", ["kappa", "lambda", "mu"])
    assert steps and steps[1]["param"] == "mu" and steps[1]["value"] == 0.5
    steps2 = _parse_model_intent("把 mu 设为 0.9", ["kappa", "lambda", "mu"])
    assert steps2 and steps2[1]["param"] == "mu" and steps2[1]["value"] == 0.9
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
