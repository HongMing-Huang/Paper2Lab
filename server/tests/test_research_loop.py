"""#51 P0-C acceptance: the FULL research loop — inspect_model →
propose_hypothesis → plan_experiment → execute_skill → verify_result →
compare_to_claim → choose_next_experiment — over 10 continuous rounds of
Fork/Compare on the MM 4-state paper model, executed through the REAL
engine bridge. Plus the restart-safety contract: replaying the same loop
never produces duplicate Runs.
"""
from __future__ import annotations

import json
import shutil
import sys
import uuid
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from asgi_lifespan import LifespanManager  # noqa: E402
from server.main import app  # noqa: E402

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not (ROOT / "node_modules" / ".bin" / "tsx").exists(),
    reason="research loop needs the engine bridge (node + tsx)",
)

MODEL_BASE = {
    "states": ["S", "C", "E", "P"],
    "rhs": {
        "S": "-\\kappa S E + \\lambda C",
        "C": "\\kappa S E - \\lambda C - \\mu C",
        "E": "-\\kappa S E + \\lambda C + \\mu C",
        "P": "\\mu C",
    },
    "params": {"kappa": 1, "lambda": 0.2, "mu": 0.4},
    "initialState": {"S": 1, "C": 0, "E": 0.1, "P": 0},
    "tSpan": [0, 20],
}
CONTEXT = {
    "deskKind": "model",
    "execution": "server",
    "params": ["kappa", "lambda", "mu"],
    "base": MODEL_BASE,
    "spec": {
        "claims": [
            {"statement": "E+C 和 S+C+P 沿每条轨迹守恒", "anchorPrecision": "region"},
            {"statement": "产物 P 单调上升趋近初始底物水平", "anchorPrecision": "region"},
        ],
        "quantities": [
            {"name": "S", "role": "state", "nominal": 1},
            {"name": "mu", "role": "parameter", "nominal": 0.4},
        ],
        "states": ["S", "C", "E", "P"],
    },
}


async def _loop(client: httpx.AsyncClient, session_id: str, rounds: int = 10) -> list[dict]:
    events: list[dict] = []
    async with client.stream(
        "POST", "/api/agent/turn",
        json={"sessionId": session_id, "intent": "连续研究循环：系统探索参数", "context": {**CONTEXT, "loop": True, "rounds": rounds}},
    ) as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


@pytest.mark.asyncio
async def test_ten_round_research_loop_real_runs() -> None:
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            events = await _loop(client, f"t-loop-{uuid.uuid4().hex[:6]}", rounds=10)
            types = [e["type"] for e in events]

            # the full loop vocabulary is present, in order, each round
            assert "inspect_model" in types
            assert types.count("propose_hypothesis") >= 10
            assert types.count("plan_experiment") >= 10
            assert types.count("choose_next_experiment") >= 9
            assert types.count("verify_result") >= 10
            assert types.count("compare_to_claim") >= 10
            assert types.count("execution_receipt") >= 10

            # 10 rounds of REAL runs (model-solved lineage)
            completed = [e for e in events if e["type"] == "experiment_completed"]
            assert len(completed) >= 10
            for e in completed:
                assert str(e.get("runId", "")).startswith("model-solved-")

            # lineage: every completed run carries a parent (fork chain)
            parents = [e.get("parentRunId") for e in completed]
            assert all(parents), "every loop run must have a parent (Fork lineage)"

            # the hypothesis cycle covers all params with ×2/÷2 alternation
            hyps = [e for e in events if e["type"] == "propose_hypothesis"]
            params_seen = {h.get("param") for h in hyps}
            assert params_seen == {"kappa", "lambda", "mu"}
            # the deterministic factor ladder starts ×2 over the params
            factors = [h.get("factor") for h in hyps[:4]]
            assert factors[:3] == [2.0, 2.0, 2.0]  # first pass: ×2 per param
            assert factors[3] == 0.5  # second pass: ÷2

            # verify_result all finite-metric ok
            verifies = [e for e in events if e["type"] == "verify_result"]
            assert all(v.get("ok") for v in verifies)

            # compare_to_claim carries the paper's claims
            cmp_claim = next(e for e in events if e["type"] == "compare_to_claim")
            assert any("守恒" in c for c in cmp_claim.get("claims", []))

            assert types[-1] == "done" and events[-1]["reason"] == "loop_complete"
            assert events[-1].get("rounds") == 10

            # distinct runs — a loop of forks never repeats a runId
            run_ids = [e["runId"] for e in completed]
            assert len(set(run_ids)) == len(run_ids)


@pytest.mark.asyncio
async def test_loop_replay_produces_no_duplicate_runs() -> None:
    """restart/replay safety (#51): re-posting the SAME loop on the SAME
    session replays the recorded runIds — zero new Runs."""
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            sid = f"t-loop2-{uuid.uuid4().hex[:6]}"  # ONE session: both calls
            first = await _loop(client, sid, rounds=3)
            completed_first = [e["runId"] for e in first if e["type"] == "experiment_completed"]
            assert len(completed_first) >= 3

            second = await _loop(client, sid, rounds=3)  # same session, same base
            types = [e["type"] for e in second]
            assert "loop_replay" in types
            assert "experiment_completed" not in types, "replay must not execute new runs"
            replay = next(e for e in second if e["type"] == "loop_replay")
            assert replay.get("runIds") == completed_first
            assert types[-1] == "done" and second[-1]["reason"] == "loop_already_complete"


@pytest.mark.asyncio
async def test_failed_round_is_recorded_loop_continues() -> None:
    """a bad round (invalid param) records the failure and the loop keeps
    going — never retries the failed round blindly."""
    bad_ctx = {**CONTEXT, "params": ["kappa", "lambda", "mu", "S"]}  # S is a STATE — scale on it fails the fork gate
    events: list[dict] = []
    async with LifespanManager(app) as mgr:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mgr.app), base_url="http://t") as client:
            async with client.stream(
                "POST", "/api/agent/turn",
                json={"sessionId": f"t-loop3-{uuid.uuid4().hex[:6]}", "intent": "连续研究循环", "context": {**bad_ctx, "loop": True, "rounds": 4}},
            ) as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        events.append(json.loads(line[6:]))
    types = [e["type"] for e in events]
    assert types[-1] == "done"
    # rounds that hit S failed with a receipt carrying the reason…
    failed_receipts = [
        e for e in events
        if e["type"] == "execution_receipt" and e.get("receipt", {}).get("failureReason")
    ]
    assert any("S" in (r["receipt"].get("failureReason") or "") for r in failed_receipts)
    # …and the loop still completed its good rounds (kappa/lambda/mu cycle)
    completed = [e for e in events if e["type"] == "experiment_completed"]
    assert len(completed) >= 4
