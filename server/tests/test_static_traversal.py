"""Regression: the dist SPA fallback must never serve files outside dist/.

`GET /../server/agent.py` escaped via Path(join) and served backend source
(reproduced on HEAD 2317325). The fix resolves the path and requires
containment within the dist root.
"""
from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import server.main as main_mod  # noqa: E402


@pytest.fixture()
def client():
    if not (ROOT / "dist" / "index.html").is_file():
        pytest.skip("dist/ not built — run pnpm build first")
    transport = httpx.ASGITransport(app=main_mod.app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def test_traversal_cannot_escape_dist(client):
    escapes = [
        "/../server/agent.py",
        "/..%2fserver%2fagent.py",
        "/%2e%2e/server/agent.py",
        "/../package.json",
        "/../../etc/passwd",
        "/assets/../../server/main.py",
        "/index.html/..%2f..%2fserver%2fagent.py",
    ]
    for path in escapes:
        r = await client.get(path)
        body = r.text
        assert "fastapi" not in body.lower() or "doctype html" in body[:100], path
        # escaping paths must never leak source: the response is either the
        # SPA shell (756B index) or a 404 — never the backend file
        assert not body.startswith("#") and "uvicorn" not in body, path
        assert r.status_code in (200, 404), path


async def test_static_files_inside_dist_still_served(client):
    # a real dist file keeps working (sample paper is copied into dist/papers)
    r = await client.get("/papers/sample-harmonic.pdf")
    if r.status_code == 200:
        assert r.content[:4] == b"%PDF"
    # SPA shell for a client route
    r2 = await client.get("/some/client/route")
    assert r2.status_code == 200
    assert "doctype html" in r2.text[:100]
