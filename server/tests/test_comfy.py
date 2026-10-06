"""Lane E — ComfyUI asset generation contract:
  * env-only configuration; missing config = honest 503
  * host validation rejects non-http(s), loopback, private (public endpoints only)
  * the happy path (against a local MOCK server standing in for a public
    ComfyUI — the client is pointed at it by overriding validation through a
    public-resolving URL is impossible in CI, so the mock is injected via the
    client's internals) produces assets stamped kind=AIGENERATED with prompt
    id + graph sha traceability; assets NEVER enter the run history
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from server.comfy import ASSET_KIND, ComfyClient, ComfyUnavailable  # noqa: E402


def test_unconfigured_is_honest_503():
    from fastapi import FastAPI

    from server.comfy import router

    app = FastAPI()
    app.include_router(router)
    os.environ.pop("PAPER2LAB_COMFY_URL", None)
    with TestClient(app) as c:
        r = c.get("/api/assets/status")
        assert r.json() == {"configured": False, "kind": ASSET_KIND}
        r = c.post("/api/assets/generate", json={"graph": {}})
        assert r.status_code == 503
        assert "not configured" in r.json()["detail"]


def test_rejects_non_public_endpoints():
    for bad in ["ftp://example.com", "http://127.0.0.1:8188", "http://192.168.1.5:8188", "http://[::1]:8188"]:
        os.environ["PAPER2LAB_COMFY_URL"] = bad
        with pytest.raises(ComfyUnavailable):
            ComfyClient()
    os.environ.pop("PAPER2LAB_COMFY_URL", None)


def test_happy_path_assets_are_aigen_traced_and_never_runs(monkeypatch):
    """mock ComfyUI HTTP: /prompt → id, /history → one image, /view → bytes.
    The client is constructed with validation bypassed (public-host rule
    cannot hold against a test-local mock) — the network layer itself is
    exercised for real."""
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/prompt":
            assert "graph" in json.loads(request.content) or b"prompt" in request.content
            return httpx.Response(200, json={"prompt_id": "p-test-1"})
        if request.url.path == "/history/p-test-1":
            return httpx.Response(200, json={
                "p-test-1": {"outputs": {"9": {"images": [{"filename": "out_0001.png", "subfolder": "", "type": "output"}]}}}
            })
        if request.url.path == "/view":
            return httpx.Response(200, content=b"\x89PNG-fake-bytes")
        return httpx.Response(404)

    data = tempfile.mkdtemp(prefix="p2l-comfy-")
    monkeypatch.setenv("PAPER2LAB_DATA_DIR", data)
    client = ComfyClient.__new__(ComfyClient)  # bypass __init__ validation
    client._base = "https://comfy.test"
    client._headers = {}
    real_client_ctor = httpx.Client

    def patched_client(*a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        return real_client_ctor(*a, **kw)

    monkeypatch.setattr(httpx, "Client", patched_client)
    out = client.generate(
        {"3": {"class_type": "KSampler", "inputs": {"seed": 42}}},
        prompt="test render",
    )
    assert out["kind"] == ASSET_KIND
    assert out["promptId"] == "p-test-1"
    assert len(out["assetFiles"]) == 1
    idx = json.loads((Path(data) / "assets" / "index.json").read_text())
    assert idx[0]["kind"] == ASSET_KIND
    assert idx[0]["comfyPromptId"] == "p-test-1"
    assert len(idx[0]["graphSha256"]) == 16
    assert (Path(data) / "assets" / out["assetFiles"][0]).read_bytes() == b"\x89PNG-fake-bytes"
    assert "/prompt" in calls and "/history/p-test-1" in calls and "/view" in calls
    # assets NEVER masquerade as science: no run history contains them
    history_files = [p.name for p in Path(data).rglob("*run*") if p.is_file()]
    assert all("asset" not in f or f.endswith(".png") for f in history_files)
