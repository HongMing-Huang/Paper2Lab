"""Regression test for the AgentScope event-type mapping bug.

The installed AgentScope (2.0.9) returns UPPERCASE event values
('REQUIRE_EXTERNAL_EXECUTION'); server/agent.py used to compare raw values
against lowercase names and silently dropped execution requests from the
real (agentscope-qwen) backend. This test pins the normalization against the
REAL event classes from the installed library.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from agentscope.event import RequireExternalExecutionEvent  # noqa: E402
from agentscope.message import ToolCallBlock, ToolResultBlock, ToolResultState  # noqa: E402

from server.agent import _evt_type  # noqa: E402


def _real_require_event() -> RequireExternalExecutionEvent:
    call = ToolCallBlock(id="call-1", name="scientific_execute", input='{"deskKind":"kakeya"}')
    return RequireExternalExecutionEvent(reply_id="reply-1", tool_calls=[call])


def test_event_values_are_uppercase_in_installed_agentscope():
    ev = _real_require_event()
    # documents the root cause: the raw enum value is UPPERCASE
    assert str(ev.type) == "REQUIRE_EXTERNAL_EXECUTION" or getattr(ev.type, "value", "") == "REQUIRE_EXTERNAL_EXECUTION"


def test_normalized_type_matches_stream_branches():
    ev = _real_require_event()
    assert _evt_type(ev) == "require_external_execution"


def test_normalized_type_matches_tool_call_start():
    from agentscope.event import ToolCallStartEvent

    ev = ToolCallStartEvent(reply_id="r", tool_call_id="c1", tool_call_name="scientific_execute")
    assert _evt_type(ev) == "tool_call_start"


def test_normalized_type_matches_reply_end():
    from agentscope.event import ReplyEndEvent

    ev = ReplyEndEvent(session_id="s", reply_id="r")
    assert _evt_type(ev) == "reply_end"


def test_result_block_construction_roundtrip():
    # the resume path builds ToolResultBlock(id, name, output, state) — pin it
    block = ToolResultBlock(id="call-1", name="scientific_execute", output="{}", state=ToolResultState.SUCCESS)
    assert block.id == "call-1"
