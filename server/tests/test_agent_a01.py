"""A0.1 — session-scoped agent-turn state: the ok-summary lives per session
(two interleaved sessions never read each other's numbers), turns on ONE
session serialize (the shared agentscope agent is not concurrency-safe), and
the lock releases on completion AND on exception (an aborted turn cannot
deadlock the session forever)."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from server.agent import session_turn, get_session_summary, set_session_summary  # noqa: E402


pytestmark = [pytest.mark.asyncio]


class TestSummaryIsolation:
    async def test_two_interleaved_sessions_never_read_each_others_summary(self):
        # session A sets its summary mid-turn; session B runs a FULL turn and
        # clears its own — A's summary must survive B's lifecycle untouched
        async with session_turn("sess-A"):
            set_session_summary("sess-A", "A 的真实计算结果 run-A1")
            async with session_turn("sess-B"):
                set_session_summary("sess-B", "B 的真实计算结果 run-B1")
                assert get_session_summary("sess-B") == "B 的真实计算结果 run-B1"
                # while both are live, each reads its OWN value
                assert get_session_summary("sess-A") == "A 的真实计算结果 run-A1"
            # B's turn ended and released its state; A's is intact
            assert get_session_summary("sess-B") is None
            assert get_session_summary("sess-A") == "A 的真实计算结果 run-A1"
        assert get_session_summary("sess-A") is None  # released with A's turn

    async def test_a_new_turn_on_the_same_session_starts_clean(self):
        async with session_turn("sess-C"):
            set_session_summary("sess-C", "上一回合的数字")
        async with session_turn("sess-C"):
            assert get_session_summary("sess-C") is None  # no stale carry-over


class TestSessionSerialLock:
    async def test_turns_on_one_session_serialize(self):
        order: list[str] = []
        started = asyncio.Event()

        async def turn(tag: str, hold: float) -> None:
            async with session_turn("sess-S"):
                order.append(f"enter-{tag}")
                if tag == "first":
                    started.set()
                await asyncio.sleep(hold)
                order.append(f"exit-{tag}")

        # launch the first turn; once it is INSIDE, launch the second — the
        # second must not enter until the first exits
        t1 = asyncio.create_task(turn("first", 0.15))
        await started.wait()
        t2 = asyncio.create_task(turn("second", 0.0))
        await asyncio.gather(t1, t2)
        assert order == ["enter-first", "exit-first", "enter-second", "exit-second"]

    async def test_different_sessions_run_concurrently(self):
        order: list[str] = []
        both_in = asyncio.Event()

        async def turn(tag: str) -> None:
            async with session_turn(f"sess-{tag}"):
                order.append(f"enter-{tag}")
                if len(order) == 2:
                    both_in.set()
                await both_in.wait()  # only passes if BOTH sessions are inside simultaneously

        await asyncio.wait_for(asyncio.gather(turn("X"), turn("Y")), timeout=2.0)
        assert set(order) == {"enter-X", "enter-Y"}

    async def test_an_aborted_turn_releases_the_lock(self):
        with pytest.raises(RuntimeError, match="boom"):
            async with session_turn("sess-E"):
                raise RuntimeError("boom")
        # the very next turn on the same session acquires immediately
        async with session_turn("sess-E"):
            pass


class TestNoModuleGlobalLeft:
    async def test_the_module_level_global_summary_is_gone(self):
        import server.agent as agent_mod

        assert not hasattr(agent_mod, "_last_ok_summary"), (
            "the global _last_ok_summary must not exist — summaries are session state"
        )
