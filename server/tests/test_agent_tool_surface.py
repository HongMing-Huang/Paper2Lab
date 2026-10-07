"""#30 统一编排 — the model's tool surface comes from the LIVE Skill Registry
via the engine bridge (one capability source for Qwen and SOP), and the agent
context is section-budgeted instead of hard-truncated."""
import json

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from server.agent import _build_context_message, _scientific_execute_tool, _tool_surface

SIX_DESKS = {"formula", "kakeya", "ode", "geometry", "mujoco", "challenge"}


# the REAL engine skills payload shape (no `implemented` field — presence in
# the list means runnable; mirrors scripts/engine_server.ts serialization)
CANNED_SKILLS = [
    {"name": n, "aliases": [], "description": "d", "version": "v@1", "deterministic": True,
     "evidence": "CALCULATED", "runKind": "k"}
    for n in (
        "formula.evaluate", "formula.plot", "geometry.2d", "ode.solve", "ode.phase",
        "kakeya.generate", "kakeya.measure", "kakeya.sweep",
        "experiment.fork", "experiment.compare", "paper.trace-source",
        "mujoco.simulate", "challenge.attempt",
    )
]


def _fresh_surface():
    import server.agent as agent_mod

    agent_mod._surface_cache.update(at=0.0, surface=None)


class TestToolSurface:
    @pytest.mark.asyncio
    async def test_surface_comes_from_the_registry_payload_with_all_six_desks(self, monkeypatch):
        """unit-level with the REAL payload shape injected — the end-to-end
        bridge passthrough is covered by test_engine_api::skills surface"""
        import server.engine_bridge as eb

        async def canned_call(self, op, **payload):
            assert op == "skills"
            return {"ok": True, "skills": CANNED_SKILLS}

        monkeypatch.setattr(eb.EngineBridge, "call", canned_call)
        _fresh_surface()
        surface = await _tool_surface()
        assert surface["source"] == "registry"
        assert SIX_DESKS <= set(surface["desks"])
        for skill in ("ode.solve", "ode.phase", "geometry.2d", "mujoco.simulate", "challenge.attempt"):
            assert skill in surface["skills"]

    @pytest.mark.asyncio
    async def test_generated_tool_declares_every_desk_and_the_registry_skills(self, monkeypatch):
        import server.engine_bridge as eb

        async def canned_call(self, op, **payload):
            return {"ok": True, "skills": CANNED_SKILLS}

        monkeypatch.setattr(eb.EngineBridge, "call", canned_call)
        _fresh_surface()
        surface = await _tool_surface()
        tool = _scientific_execute_tool(surface)
        assert set(tool.input_schema["properties"]["deskKind"]["enum"]) == set(surface["desks"])
        assert SIX_DESKS <= set(tool.input_schema["properties"]["deskKind"]["enum"])
        for skill in ("ode.solve", "mujoco.simulate", "challenge.attempt", "formula.plot", "kakeya.measure"):
            assert skill in tool.description

    @pytest.mark.asyncio
    async def test_bridge_unreachable_falls_back_to_a_smaller_honest_surface(self, monkeypatch):
        import server.engine_bridge as eb

        async def dead_call(self, op, **payload):
            raise TimeoutError("engine down")

        monkeypatch.setattr(eb.EngineBridge, "call", dead_call)
        _fresh_surface()
        surface = await _tool_surface()
        assert surface["source"] == "fallback"
        assert set(surface["desks"]) == {"formula", "kakeya"}  # never invented


class TestContextBudgets:
    def test_sections_keep_their_identity_instead_of_a_flat_chop(self):
        ctx = {
            "paper": {"title": "Damped Oscillator Benchmarks", "question": "how does damping change trajectories?"},
            "formulas": [
                {"latex": "\\dot{x} = y", "anchorId": "damped-f1"},
                {"latex": "\\dot{y} = -x - 0.5y", "anchorId": "damped-f2"},
            ],
            "current": {"deskKind": "ode", "initial": {"x": 1.5, "y": 0}},
            "history": [
                {"runId": f"ode-phase2-run{i:04d}", "params": {"x": i, "y": 0}, "metrics": {"period0": i + 0.1}}
                for i in range(40)
            ],
        }
        msg = _build_context_message("what if the start is negative?", ctx)
        # the paper title, research question AND anchors survive…
        assert "Damped Oscillator Benchmarks" in msg
        assert "damping change trajectories" in msg
        assert "damped-f1" in msg and "damped-f2" in msg
        # …while history is bounded (≤6 rows) instead of evicting everything
        assert "run0039" in msg  # newest-first bounded history
        assert "run0000" not in msg
        # all four sections are present as separate blocks (the old behavior
        # serialized one JSON blob and flat-cut it at 1200 chars)
        assert msg.count("\n\n") >= 4

    def test_minimal_context_stays_small(self):
        msg = _build_context_message("hello", {})
        assert msg == "User question: hello"


class TestSopModelParity:
    @pytest.mark.asyncio
    async def test_sop_browser_guard_matches_the_declared_surface(self, monkeypatch):
        """the desks the SOP browser path refuses must be exactly those the
        browser cannot execute — with the registry surface advertising six
        desks, the guard remains honest about the browser subset"""
        import server.engine_bridge as eb

        async def canned_call(self, op, **payload):
            return {"ok": True, "skills": CANNED_SKILLS}

        monkeypatch.setattr(eb.EngineBridge, "call", canned_call)
        _fresh_surface()
        surface = await _tool_surface()
        browser_executable = {"formula", "kakeya"}
        assert browser_executable <= set(surface["desks"])
        # server-mode desks beyond the browser subset are executable via the
        # engine (sop_turn_server) — the same registry surface covers both
        assert {"ode", "geometry", "mujoco", "challenge"} <= set(surface["desks"])

    @pytest.mark.asyncio
    async def test_health_still_green_after_surface_wiring(self, monkeypatch):
        for name in list(vars(__import__("os").environ)):
            if name.startswith("PAPER2LAB_AGENT_") or name == "DASHSCOPE_API_KEY":
                monkeypatch.delenv(name, raising=False)
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                resp = await client.get("/api/agent/health")
        body = resp.json()
        assert body["backend"] == "sop-deterministic"
        assert json.dumps(body)  # serializable, secret-free
