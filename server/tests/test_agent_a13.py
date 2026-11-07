"""A1.3 — the AgentScope server-execution path keeps operation identity:
multi-round tool calls continue from the TURN'S LATEST run (baseRunId, not a
re-read of the original base — the R8 defect), a desk mismatch is an EXPLICIT
error the model can see (never a silent op-prefix rewrite), and an identical
retried batch reuses one deterministic operationId (zero duplicate forks with
the engine-side ledger). Protocol-level tests mock the bridge; the end-to-end
turn behaviour stays covered by test_agent_server_mode.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from server.agent import _server_run_tool_call  # noqa: E402


def _call(name: str, input_json: str) -> SimpleNamespace:
    return SimpleNamespace(id=f"call_{name}", name="scientific_execute", input=input_json)


FORMULA_STEPS = json.dumps({"deskKind": "formula", "steps": [{"op": "formula.set", "param": "a", "value": 3}]})


class _BridgeSpy:
    def __init__(self, result: dict | None = None):
        self.calls: list[dict] = []
        self.result = result or {
            "ok": True,
            "result": {
                "runs": [{"runId": "formula-value-r1", "metrics": {"value": 3}}],
                "targetRunId": "formula-value-r1",
                "comparison": None,
            },
        }

    async def call(self, op: str, **kwargs):
        self.calls.append({"op": op, **kwargs})
        return self.result


@pytest.fixture
def bridge_spy(monkeypatch):
    def install(result: dict | None = None):
        import server.engine_bridge as eb

        spy = _BridgeSpy(result)
        monkeypatch.setattr(eb, "bridge", spy)
        return spy
    return install


class TestDeskMismatchIsExplicit:
    async def test_mismatched_desk_is_an_error_the_model_sees_and_the_engine_is_not_called(self, bridge_spy):
        spy = bridge_spy()
        context = {"deskKind": "formula", "execution": "server", "base": {"expression": ["Multiply", "a", "x"], "values": {"a": 1}}}
        ok, payload = await _server_run_tool_call(
            _call("mismatch", json.dumps({"deskKind": "ode", "steps": [{"op": "ode.set", "param": "alpha", "value": 2}]})),
            {"deskKind": "ode", "steps": [{"op": "ode.set", "param": "alpha", "value": 2}]},
            "把 alpha 加倍",
            context,
        )
        assert ok is False
        assert "desk" in str(payload).lower()
        assert "formula" in str(payload)  # the pinned desk is named
        assert spy.calls == []  # no silent rewrite → no engine call at all


class TestBaseChain:
    async def test_round_two_continues_from_the_turns_latest_run_not_the_original_base(self, bridge_spy):
        spy = bridge_spy()
        context = {
            "deskKind": "formula",
            "execution": "server",
            "base": {"expression": ["Multiply", "a", "x"], "values": {"a": 1}},
        }
        turn_state: dict = {}
        await _server_run_tool_call(_call("r1", FORMULA_STEPS), json.loads(FORMULA_STEPS), "a 设为 3", context, turn_state)
        await _server_run_tool_call(_call("r2", json.dumps({"deskKind": "formula", "steps": [{"op": "formula.scale", "param": "a", "value": 2}]})),
                                    {"deskKind": "formula", "steps": [{"op": "formula.scale", "param": "a", "value": 2}]},
                                    "再翻倍", context, turn_state)
        assert len(spy.calls) == 2
        first, second = spy.calls
        assert "baseRunId" not in first  # round 1 seeds from the context base
        assert first["base"] == context["base"]
        assert second.get("baseRunId") == "formula-value-r1"  # round 2 continues the chain
        assert second.get("base") in (None, {}, {"expression": ["Multiply", "a", "x"], "values": {"a": 1}}) or "base" not in second

    async def test_a_failed_round_does_not_poison_the_chain(self, bridge_spy):
        # round 1 fails → nothing recorded → round 2 still seeds from the base
        spy = bridge_spy({"ok": False, "error": "boom"})
        context = {"deskKind": "formula", "execution": "server", "base": {"expression": ["Multiply", "a", "x"], "values": {"a": 1}}}
        turn_state: dict = {}
        await _server_run_tool_call(_call("f1", FORMULA_STEPS), json.loads(FORMULA_STEPS), "a 设为 3", context, turn_state)
        spy.result = {"ok": True, "result": {"runs": [{"runId": "formula-value-r2", "metrics": {}}], "targetRunId": "formula-value-r2"}}
        await _server_run_tool_call(_call("f2", FORMULA_STEPS), json.loads(FORMULA_STEPS), "重试", context, turn_state)
        assert spy.calls[1].get("baseRunId") is None
        assert spy.calls[1]["base"] == context["base"]


class TestInternalFailureEnvelope:
    async def test_a_batch_that_ran_but_failed_internally_is_an_error_to_the_model(self, bridge_spy):
        # engine answers ok:true with result.status=error (partial runs kept) —
        # the outer envelope must NOT report ok while the engine says error
        spy = bridge_spy({"ok": True, "result": {"status": "error", "runs": [{"runId": "r-partial", "metrics": {}}], "message": "terminal op failed"}})
        context = {"deskKind": "formula", "execution": "server", "base": {"expression": ["Multiply", "a", "x"], "values": {"a": 1}}}
        turn_state: dict = {}
        ok, payload = await _server_run_tool_call(_call("e1", FORMULA_STEPS), json.loads(FORMULA_STEPS), "会失败的批次", context, turn_state)
        assert ok is False
        assert isinstance(payload, dict) and payload.get("status") == "error"
        assert "terminal op failed" in payload.get("message", "")
        assert "latestRunId" not in turn_state  # a failed round never poisons the chain


class TestOperationIdentity:
    async def test_identical_retried_batches_carry_one_deterministic_operationId(self, bridge_spy):
        spy = bridge_spy()
        context = {"deskKind": "formula", "execution": "server", "base": {"expression": ["Multiply", "a", "x"], "values": {"a": 1}}}
        await _server_run_tool_call(_call("t1", FORMULA_STEPS), json.loads(FORMULA_STEPS), "a 设为 3", context, {})
        await _server_run_tool_call(_call("t2", FORMULA_STEPS), json.loads(FORMULA_STEPS), "a 设为 3（重试）", context, {})
        ids = [c.get("operationId") for c in spy.calls]
        assert ids[0] is not None and ids[0] == ids[1]

    async def test_different_steps_get_different_operationIds(self, bridge_spy):
        spy = bridge_spy()
        context = {"deskKind": "formula", "execution": "server", "base": {"expression": ["Multiply", "a", "x"], "values": {"a": 1}}}
        await _server_run_tool_call(_call("d1", FORMULA_STEPS), json.loads(FORMULA_STEPS), "a 设为 3", context, {})
        other = json.dumps({"deskKind": "formula", "steps": [{"op": "formula.set", "param": "a", "value": 4}]})
        await _server_run_tool_call(_call("d2", other), json.loads(other), "a 设为 4", context, {})
        ids = [c.get("operationId") for c in spy.calls]
        assert ids[0] != ids[1]


pytestmark = [pytest.mark.asyncio]
