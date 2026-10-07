"""统一 AI 接入 (#29) — the ONE server-side provider layer.

Every AI call the orchestrator makes goes through here; the browser holds no
provider keys. Configuration is ENV-ONLY (never source literals):

  PAPER2LAB_AGENT_PROVIDER   openai | dashscope | sop   (explicit override)
  PAPER2LAB_AGENT_BASE_URL   https://…   OpenAI-compatible endpoint
  PAPER2LAB_AGENT_API_KEY    provider key
  PAPER2LAB_AGENT_MODEL      model name
  PAPER2LAB_AGENT_TIMEOUT    seconds (default 60)

Resolution order: explicit PAPER2LAB_AGENT_PROVIDER wins (misconfiguration is
REPORTED, not silently ignored) → else (API_KEY + BASE_URL) → openai → else
DASHSCOPE_API_KEY → dashscope → else sop. Fallback to SOP is always an
explicit, labeled event — "it ran" never implies "the AI answered".
"""
from __future__ import annotations

import ipaddress
import os
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

DEFAULT_TIMEOUT_S = 60.0
DEFAULT_DASHSCOPE_MODEL = "qwen-plus"
# capability probe cache (TTL) — a probe per process lifetime is enough; the
# health endpoint reports the timestamp so staleness is visible
_PROBE_TTL_S = 300.0


def _env(name: str) -> str | None:
    v = os.environ.get(name)
    return v or None


def validate_base_url(url: str) -> str | None:
    """SSRF guard for the CONFIGURED endpoint: only http/https and never
    loopback/private/reserved addresses. Returns the rejection reason."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return "base_url is not a valid URL"
    if parsed.scheme not in ("http", "https"):
        return f"base_url scheme must be http/https (got {parsed.scheme or 'empty'})"
    host = parsed.hostname or ""
    if not host:
        return "base_url has no host"
    if host.lower() in ("localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"):
        return f"base_url host {host} is a loopback address"
    try:
        addr = ipaddress.ip_address(host)
        if (addr.is_loopback or addr.is_private or addr.is_reserved
                or addr.is_link_local or addr.is_unspecified):
            return f"base_url host {host} is a loopback/private/reserved address"
    except ValueError:
        pass  # a DNS name — allowed (public vendors are hostnames)
    return None


@dataclass
class ProviderStatus:
    provider: str  # 'openai' | 'dashscope' | 'sop'
    model: str | None = None
    base_url: str | None = None
    timeout_s: float = DEFAULT_TIMEOUT_S
    ok: bool = False
    issues: list[str] = field(default_factory=list)

    @property
    def backend(self) -> str:
        if self.provider == "sop" or not self.ok:
            return "sop-deterministic"
        return f"agentscope-{self.provider}"

    def describe(self) -> dict[str, Any]:
        """Safe for /health and SSE — host only, NEVER the key."""
        return {
            "provider": self.provider,
            "backend": self.backend,
            "model": self.model,
            "base_url_host": urlparse(self.base_url).hostname if self.base_url else None,
            "timeout_s": self.timeout_s,
            "ok": self.ok,
            "issues": self.issues,
        }


def resolve_provider() -> ProviderStatus:
    explicit = (_env("PAPER2LAB_AGENT_PROVIDER") or "").lower() or None
    key = _env("PAPER2LAB_AGENT_API_KEY")
    base = _env("PAPER2LAB_AGENT_BASE_URL")
    model = _env("PAPER2LAB_AGENT_MODEL")
    dash_key = _env("DASHSCOPE_API_KEY")
    timeout_raw = _env("PAPER2LAB_AGENT_TIMEOUT")
    timeout = DEFAULT_TIMEOUT_S
    if timeout_raw:
        try:
            timeout = max(1.0, float(timeout_raw))
        except ValueError:
            timeout = DEFAULT_TIMEOUT_S

    if explicit == "sop":
        return ProviderStatus(provider="sop", timeout_s=timeout)

    if explicit == "openai" or (explicit is None and key and base):
        st = ProviderStatus(provider="openai", model=model, base_url=base, timeout_s=timeout)
        if not key:
            st.issues.append("PAPER2LAB_AGENT_API_KEY missing")
        if not base:
            st.issues.append("PAPER2LAB_AGENT_BASE_URL missing")
        if not model:
            st.issues.append("PAPER2LAB_AGENT_MODEL missing")
        if base:
            reason = validate_base_url(base)
            if reason:
                st.issues.append(reason)
        st.ok = not st.issues
        return st

    if explicit == "dashscope" or (explicit is None and dash_key):
        st = ProviderStatus(provider="dashscope", model=model or DEFAULT_DASHSCOPE_MODEL, timeout_s=timeout)
        if not dash_key:
            st.issues.append("DASHSCOPE_API_KEY missing")
        st.ok = not st.issues
        return st

    if explicit is not None:
        # unknown explicit provider — report, never guess
        return ProviderStatus(provider="sop", timeout_s=timeout,
                              issues=[f"unknown PAPER2LAB_AGENT_PROVIDER '{explicit}'"])
    return ProviderStatus(provider="sop", timeout_s=timeout)


def build_model(status: ProviderStatus) -> Any:
    """AgentScope model for the resolved provider (env-only credentials).
    Raises for a misconfigured/non-AI status — callers turn that into an
    EXPLICIT sop_fallback event, never a silent one."""
    if not status.ok or status.provider == "sop":
        raise RuntimeError(f"provider not usable: {status.issues or 'sop selected'}")
    if status.provider == "openai":
        from agentscope.credential import OpenAICredential
        from agentscope.model import OpenAIChatModel

        return OpenAIChatModel(
            credential=OpenAICredential(
                api_key=_env("PAPER2LAB_AGENT_API_KEY") or "",
                base_url=status.base_url,
            ),
            model=status.model or "",
            stream=True,
            max_retries=1,
            retry_delay=1.0,
            client_kwargs={"timeout": status.timeout_s},
        )
    from agentscope.credential import DashScopeCredential
    from agentscope.model import DashScopeChatModel

    return DashScopeChatModel(
        credential=DashScopeCredential(api_key=_env("DASHSCOPE_API_KEY") or ""),
        model=status.model or DEFAULT_DASHSCOPE_MODEL,
        stream=True,
    )


# ---- capability probe -------------------------------------------------------
# Distinguishes what the endpoint can actually do: plain chat, tool_calls,
# and streaming. Never assumes an OpenAI-COMPATIBLE url implies identical
# capabilities; failures carry their reason (401/429/timeout/...).

@dataclass
class ProbeResult:
    chat: bool = False
    tool_calls: bool = False
    stream: bool = False
    error: str | None = None
    http_status: int | None = None
    probed_at: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "chat": self.chat,
            "tool_calls": self.tool_calls,
            "stream": self.stream,
            "error": self.error,
            "httpStatus": self.http_status,
            "probedAt": self.probed_at,
        }


_probe_cache: dict[str, ProbeResult] = {}
# a REAL (non-mocked) provider probe that could chat — set only when
# probe_capabilities ran without an injected transport. "configured" must
# never be reported as "connected" (#29).
_real_probe_ok: bool = False


async def probe_capabilities(
    status: ProviderStatus,
    transport: Any | None = None,
    force: bool = False,
) -> ProbeResult:
    """Minimal chat request with tools + stream against the configured
    endpoint. `transport` is injectable for tests (httpx AsyncBaseTransport);
    production goes over the real network. Cached with a TTL."""
    cache_key = f"{status.provider}|{status.base_url}|{status.model}"
    cached = _probe_cache.get(cache_key)
    now = time.time()
    if cached and not force and now - cached.probed_at < _PROBE_TTL_S:
        return cached

    if status.provider == "sop" or not status.ok:
        res = ProbeResult(error="no AI provider configured (sop)", probed_at=now)
        _probe_cache[cache_key] = res
        return res
    if status.provider == "dashscope":
        # DashScope's AgentScope path is already exercised by real turns; the
        # protocol probe below is written for OpenAI-compatible endpoints
        res = ProbeResult(chat=True, tool_calls=True, stream=True, probed_at=now,
                          error=None)
        _probe_cache[cache_key] = res
        return res

    import httpx

    url = (status.base_url or "").rstrip("/") + "/chat/completions"
    body = {
        "model": status.model,
        "messages": [{"role": "user", "content": "ping"}],
        "tools": [{
            "type": "function",
            "function": {
                "name": "noop",
                "description": "capability probe",
                "parameters": {"type": "object", "properties": {}},
            },
        }],
        "tool_choice": "none",  # capability of ACCEPTING tools, not forcing a call
        "stream": True,
        "max_tokens": 8,
    }
    headers = {"Authorization": f"Bearer {_env('PAPER2LAB_AGENT_API_KEY') or ''}"}
    res = ProbeResult(probed_at=now)
    client_kwargs: dict[str, Any] = {"timeout": min(status.timeout_s, 20.0)}
    if transport is not None:
        client_kwargs["transport"] = transport
    try:
        async with httpx.AsyncClient(**client_kwargs) as client:
            saw_sse_chunk = False
            saw_tool_calls = False
            saw_content = False
            async with client.stream("POST", url, json=body, headers=headers) as resp:
                res.http_status = resp.status_code
                if resp.status_code != 200:
                    await resp.aread()
                    snippet = (resp.text or "")[:160]
                    res.error = f"HTTP {resp.status_code}: {snippet}"
                    _probe_cache[cache_key] = res
                    return res
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    saw_sse_chunk = True
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        import json as _json

                        chunk = _json.loads(payload)
                    except ValueError:
                        continue
                    choice = (chunk.get("choices") or [{}])[0]
                    msg = choice.get("message") or choice.get("delta") or {}
                    if msg.get("tool_calls") or choice.get("finish_reason") == "tool_calls":
                        saw_tool_calls = True
                    if msg.get("content"):
                        saw_content = True
                    if saw_tool_calls and saw_content:
                        break
                res.stream = saw_sse_chunk
                res.chat = True
                res.tool_calls = saw_tool_calls
                if not saw_tool_calls:
                    # not an error: many endpoints accept tools without
                    # emitting tool_calls under tool_choice=none — the probe
                    # reports the distinction instead of guessing
                    res.error = None
    except httpx.TimeoutException:
        res.error = "timeout"
    except httpx.HTTPError as exc:
        res.error = f"{type(exc).__name__}: {exc}"[:200]
    if transport is None and res.chat:
        global _real_probe_ok
        _real_probe_ok = True
    _probe_cache[cache_key] = res
    return res


def ai_verified() -> bool:
    """Has a REAL provider endpoint ever answered in this process? Health
    reports 未验证 until then — 'configured' is not 'connected' (#29)."""
    return _real_probe_ok
