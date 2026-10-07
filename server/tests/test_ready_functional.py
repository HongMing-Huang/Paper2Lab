"""#31: /api/ready must prove function, not liveness — the engine check
really PINGS (a zombie child fails), and offline deployments can require
pre-downloaded Docling artifacts instead of silently downloading at parse
time. Kill-switches keep dev/cold paths workable."""
import json

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for name in list(__import__("os").environ):
        if name.startswith("PAPER2LAB_AGENT_") or name == "DASHSCOPE_API_KEY":
            monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("PAPER2LAB_READY_ENGINE_PING", raising=False)
    monkeypatch.delenv("PAPER2LAB_REQUIRE_MODEL_ARTIFACTS", raising=False)


class TestReadyEnginePing:
    @pytest.mark.asyncio
    async def test_zombie_engine_fails_ready_with_reason(self, monkeypatch):
        import server.engine_bridge as eb

        async def silent_call(self, op, **payload):
            raise TimeoutError("zombie: child alive but silent")

        monkeypatch.setattr(eb.EngineBridge, "call", silent_call)
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                resp = await client.get("/api/ready")
        assert resp.status_code == 503
        body = resp.json()
        assert body["ready"] is False
        assert body["checks"]["engine"]["ok"] is False
        assert "ping failed" in body["checks"]["engine"]["pingError"]
        # liveness is still honest — the PROCESS answers
        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                assert (await client.get("/api/health")).status_code == 200

    @pytest.mark.asyncio
    async def test_ping_kill_switch_keeps_cold_paths_ready(self, monkeypatch):
        import server.engine_bridge as eb

        async def silent_call(self, op, **payload):
            raise TimeoutError("would hang")

        monkeypatch.setattr(eb.EngineBridge, "call", silent_call)
        monkeypatch.setenv("PAPER2LAB_READY_ENGINE_PING", "0")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                resp = await client.get("/api/ready")
        body = resp.json()
        assert body["checks"]["engine"]["ok"] is True  # probe disabled by config

    @pytest.mark.asyncio
    async def test_real_engine_ready_passes(self):
        """live engine (spawned by the app) — the honest path end to end"""
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                resp = await client.get("/api/ready")
        assert resp.status_code == 200
        assert resp.json()["checks"]["engine"]["ok"] is True


class TestReadyDoclingArtifacts:
    @pytest.mark.asyncio
    async def test_flag_on_missing_artifacts_fails_ready(self, monkeypatch):
        monkeypatch.setenv("PAPER2LAB_REQUIRE_MODEL_ARTIFACTS", "1")

        class FakeSettings:
            artifacts_path = None

        import docling.datamodel.settings as ds

        monkeypatch.setattr(ds, "settings", FakeSettings, raising=False)
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                resp = await client.get("/api/ready")
        body = resp.json()
        assert body["checks"].get("doclingArtifacts", {}).get("ok") is False
        assert "not pre-downloaded" in body["checks"]["doclingArtifacts"]["error"]

    @pytest.mark.asyncio
    async def test_flag_off_default_keeps_dev_ready(self):
        """dev default: artifacts check absent — first-parse download allowed"""
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                resp = await client.get("/api/ready")
        assert "doclingArtifacts" not in resp.json()["checks"]
        assert json.dumps(resp.json())  # serializable
