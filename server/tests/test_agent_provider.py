"""#29 统一 AI 接入 — provider resolution, SSRF guard, capability probe
(mock transport — no sockets, no real credentials), explicit sop fallback,
and the secret-free health surface. Real-vendor turns are NOT claimed: with
no credentials in this environment the report is 未验证 by design."""
import json
import os

import httpx
import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from server.agent_provider import (
    DEFAULT_DASHSCOPE_MODEL,
    ProbeResult,
    ai_verified,
    build_model,
    probe_capabilities,
    resolve_provider,
    validate_base_url,
)


def _clear_env(monkeypatch, *keep: str) -> None:
    for name in (
        "PAPER2LAB_AGENT_PROVIDER",
        "PAPER2LAB_AGENT_BASE_URL",
        "PAPER2LAB_AGENT_API_KEY",
        "PAPER2LAB_AGENT_MODEL",
        "PAPER2LAB_AGENT_TIMEOUT",
        "DASHSCOPE_API_KEY",
    ):
        if name not in keep:
            monkeypatch.delenv(name, raising=False)



async def _sse_events(resp) -> list[dict]:
    events = []
    async for line in resp.aiter_lines():
        if line.startswith("data:"):
            events.append(json.loads(line[5:]))
    return events


@pytest.fixture(autouse=True)
def _reset_probe_cache():
    import server.agent_provider as ap

    ap._probe_cache.clear()
    ap._real_probe_ok = False
    yield
    ap._probe_cache.clear()
    ap._real_probe_ok = False


class TestResolve:
    def test_default_is_sop_and_honest(self, monkeypatch):
        _clear_env(monkeypatch)
        st = resolve_provider()
        assert st.provider == "sop"
        assert st.backend == "sop-deterministic"
        assert ai_verified() is False

    def test_openai_compatible_from_env(self, monkeypatch):
        _clear_env(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_AGENT_BASE_URL", "https://api.vendor.example/v1")
        monkeypatch.setenv("PAPER2LAB_AGENT_API_KEY", "test-key")
        monkeypatch.setenv("PAPER2LAB_AGENT_MODEL", "vendor-model")
        st = resolve_provider()
        assert (st.provider, st.backend, st.ok) == ("openai", "agentscope-openai", True)
        # describe() leaks the HOST but never the key
        d = st.describe()
        assert d["base_url_host"] == "api.vendor.example"
        assert "test-key" not in json.dumps(d)

    def test_dashscope_legacy_still_works(self, monkeypatch):
        _clear_env(monkeypatch)
        monkeypatch.setenv("DASHSCOPE_API_KEY", "ds-key")
        st = resolve_provider()
        assert (st.provider, st.backend) == ("dashscope", "agentscope-dashscope")
        assert st.model == DEFAULT_DASHSCOPE_MODEL

    def test_explicit_provider_wins_and_misconfig_is_reported(self, monkeypatch):
        _clear_env(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_AGENT_PROVIDER", "openai")
        # explicit openai WITHOUT key/base_url → NOT ok; issues say why
        st = resolve_provider()
        assert st.provider == "openai"
        assert st.ok is False
        assert any("API_KEY" in i for i in st.issues)
        assert st.backend == "sop-deterministic"  # unusable config runs SOP, visibly

    def test_unknown_explicit_provider_is_reported_not_guessed(self, monkeypatch):
        _clear_env(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_AGENT_PROVIDER", "azure-magic")
        st = resolve_provider()
        assert st.provider == "sop"
        assert any("unknown" in i for i in st.issues)


class TestSSRF:
    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1:8000/v1",
            "http://localhost:8000/v1",
            "http://10.1.2.3/v1",
            "http://192.168.0.5/v1",
            "http://172.16.0.1/v1",
            "http://[::1]:9000/v1",
            "http://0.0.0.0/v1",
            "http://169.254.169.254/latest/meta-data",
            "ftp://api.vendor.example/v1",
        ],
    )
    def test_rejects_non_public_or_non_http(self, url):
        assert validate_base_url(url) is not None

    def test_accepts_public_https(self):
        assert validate_base_url("https://api.vendor.example/v1") is None

    def test_private_base_url_makes_provider_unusable(self, monkeypatch):
        _clear_env(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_AGENT_PROVIDER", "openai")
        monkeypatch.setenv("PAPER2LAB_AGENT_API_KEY", "k")
        monkeypatch.setenv("PAPER2LAB_AGENT_MODEL", "m")
        monkeypatch.setenv("PAPER2LAB_AGENT_BASE_URL", "http://127.0.0.1:9/v1")
        st = resolve_provider()
        assert st.ok is False
        assert any("loopback" in i for i in st.issues)


class TestProbeMockTransport:
    """capability probe against a LOCAL PROTOCOL MOCK (httpx MockTransport):
    streaming tool_calls chunks, plain-chat-no-tools, and 401."""

    def _transport(self, handler):
        return httpx.MockTransport(handler)

    @pytest.mark.asyncio
    async def test_probe_separates_stream_toolcalls_and_chat(self, monkeypatch):
        _clear_env(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_AGENT_PROVIDER", "openai")
        monkeypatch.setenv("PAPER2LAB_AGENT_BASE_URL", "https://api.vendor.example/v1")
        monkeypatch.setenv("PAPER2LAB_AGENT_API_KEY", "k")
        monkeypatch.setenv("PAPER2LAB_AGENT_MODEL", "m")

        def handler(request: httpx.Request) -> httpx.Response:
            # assert the protocol shape we claim to speak
            body = json.loads(request.content)
            assert body["stream"] is True
            assert isinstance(body.get("tools"), list)
            sse = "\n".join(
                [
                    'data: {"choices":[{"delta":{"tool_calls":[{"id":"c1","function":{"name":"noop"}}]}}]}',
                    'data: {"choices":[{"delta":{"content":"hi"}}]}',
                    "data: [DONE]",
                ]
            )
            return httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"})

        st = resolve_provider()
        res = await probe_capabilities(st, transport=self._transport(handler), force=True)
        assert (res.chat, res.tool_calls, res.stream) == (True, True, True)
        assert res.error is None

    @pytest.mark.asyncio
    async def test_probe_reports_401_with_reason(self, monkeypatch):
        _clear_env(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_AGENT_PROVIDER", "openai")
        monkeypatch.setenv("PAPER2LAB_AGENT_BASE_URL", "https://api.vendor.example/v1")
        monkeypatch.setenv("PAPER2LAB_AGENT_API_KEY", "bad")
        monkeypatch.setenv("PAPER2LAB_AGENT_MODEL", "m")
        st = resolve_provider()
        res = await probe_capabilities(
            st,
            transport=httpx.MockTransport(lambda r: httpx.Response(401, json={"error": "bad key"})),
            force=True,
        )
        assert res.chat is False
        assert res.http_status == 401
        assert "401" in (res.error or "")

    @pytest.mark.asyncio
    async def test_probe_distinguishes_endpoint_without_streaming(self, monkeypatch):
        """an endpoint that answers JSON (ignoring stream:true) is CHAT-capable
        but NOT stream-capable — the probe must not blur that difference."""
        _clear_env(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_AGENT_PROVIDER", "openai")
        monkeypatch.setenv("PAPER2LAB_AGENT_BASE_URL", "https://api.vendor.example/v1")
        monkeypatch.setenv("PAPER2LAB_AGENT_API_KEY", "k")
        monkeypatch.setenv("PAPER2LAB_AGENT_MODEL", "m")
        st = resolve_provider()
        res = await probe_capabilities(
            st,
            transport=httpx.MockTransport(
                lambda r: httpx.Response(200, json={"choices": [{"message": {"content": "hi"}}]})
            ),
            force=True,
        )
        assert res.chat is True
        assert res.stream is False


class TestModelBuild:
    def test_openai_model_uses_base_url_credential(self, monkeypatch):
        _clear_env(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_AGENT_PROVIDER", "openai")
        monkeypatch.setenv("PAPER2LAB_AGENT_BASE_URL", "https://api.vendor.example/v1")
        monkeypatch.setenv("PAPER2LAB_AGENT_API_KEY", "k")
        monkeypatch.setenv("PAPER2LAB_AGENT_MODEL", "vendor-model")
        from agentscope.credential import OpenAICredential
        from agentscope.model import OpenAIChatModel

        model = build_model(resolve_provider())
        assert isinstance(model, OpenAIChatModel)
        assert isinstance(model.credential, OpenAICredential)
        assert model.credential.base_url == "https://api.vendor.example/v1"

    def test_misconfigured_provider_refuses_to_build(self, monkeypatch):
        _clear_env(monkeypatch)
        st = resolve_provider()
        with pytest.raises(RuntimeError, match="not usable"):
            build_model(st)


class TestTurnAndHealth:
    @pytest.mark.asyncio
    async def test_sop_default_turn_has_no_backend_event_and_works(self, monkeypatch):
        _clear_env(monkeypatch)
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                async with client.stream(
                    "POST",
                    "/api/agent/turn",
                    json={"sessionId": "p29-a", "intent": "a 增大一倍", "context": {"deskKind": "formula", "params": ["a", "b"]}},
                ) as resp:
                    events = await _sse_events(resp)
        types = [e["type"] for e in events]
        assert "backend" not in types  # SOP path: no AI claim at all
        assert "plan_created" in types

    @pytest.mark.asyncio
    async def test_provider_failure_falls_back_EXPLICITLY_with_reason(self, monkeypatch):
        """unreachable provider (DNS-dead host, NOT private → passes the SSRF
        guard) must emit backend + sop_fallback(reason) — never a silent pass"""
        _clear_env(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_AGENT_PROVIDER", "openai")
        monkeypatch.setenv("PAPER2LAB_AGENT_BASE_URL", "https://dns-dead.invalid/v1")
        monkeypatch.setenv("PAPER2LAB_AGENT_API_KEY", "k")
        monkeypatch.setenv("PAPER2LAB_AGENT_MODEL", "m")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                async with client.stream(
                    "POST",
                    "/api/agent/turn",
                    json={"sessionId": "p29-b", "intent": "a 增大一倍", "context": {"deskKind": "formula", "params": ["a", "b"]}},
                ) as resp:
                    events = await _sse_events(resp)
        types = [e["type"] for e in events]
        assert types[0] == "backend"
        assert events[0]["backend"] == "agentscope-openai"
        assert events[0]["provider"] == "openai"
        assert "sop_fallback" in types
        fallback = next(e for e in events if e["type"] == "sop_fallback")
        assert fallback["reason"]  # the failure reason travels in-band
        # the turn still completes on SOP AFTER the explicit marker
        assert "plan_created" in types[types.index("sop_fallback"):]

    @pytest.mark.asyncio
    async def test_health_reports_provider_and_probe_without_secrets(self, monkeypatch):
        _clear_env(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_AGENT_PROVIDER", "openai")
        monkeypatch.setenv("PAPER2LAB_AGENT_BASE_URL", "https://api.vendor.example/v1")
        monkeypatch.setenv("PAPER2LAB_AGENT_API_KEY", "secret-key-value")
        monkeypatch.setenv("PAPER2LAB_AGENT_MODEL", "m")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                resp = await client.get("/api/agent/health")
        body = resp.json()
        assert body["backend"] == "agentscope-openai"
        assert body["provider"]["ok"] is True
        assert "probe" in body
        assert body["aiVerified"] is False  # configured ≠ connected — honest
        assert "secret-key-value" not in json.dumps(body)

    @pytest.mark.asyncio
    async def test_route_endpoint_reports_unenhanced_without_provider(self, monkeypatch):
        _clear_env(monkeypatch)
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                resp = await client.post(
                    "/api/agent/route",
                    json={"title": "t", "formulas": [{"i": 0, "latex": "y=x"}], "textHead": "x"},
                )
        body = resp.json()
        assert body["enhanced"] is False
        assert body["reason"]  # why it did NOT use AI — in-band
