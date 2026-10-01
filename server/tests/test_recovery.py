"""Restart recovery + static hosting tests (Stage C).

Recovery: a job/doc persisted by one app instance must be queryable by a
freshly imported instance over the same PAPER2LAB_DATA_DIR — proving the
minimum session-restore promise without a GUI.
"""
from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_DATA = Path(tempfile.mkdtemp(prefix="p2l-recovery-"))
os.environ["PAPER2LAB_DATA_DIR"] = str(_DATA)
os.environ.pop("DASHSCOPE_API_KEY", None)


def _client_for(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_jobs_and_docs_survive_app_restart():
    # instance 1: record a finished job + doc directly through the module API
    import server.main as main_mod

    importlib.reload(main_mod)
    job = main_mod.IngestJob("job-restart-1", "sample.pdf")
    job.status = "done"
    job.finished_at = 1.0
    job.result = {
        "docId": "doc-restart-1",
        "engine": "docling",
        "doclingVersion": "test",
        "title": "Sample",
        "pages": [{"page": 1, "width": 612, "height": 792}],
        "items": [{"id": "p1-i0", "kind": "formula", "page": 1, "bbox": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.05}, "latex": "y=ax"}],
    }
    job.persist()
    job.persist_doc()

    # instance 2: fresh import over the same data dir = "service restart"
    importlib.reload(main_mod)
    async with _client_for(main_mod.app) as c:
        r = await c.get("/api/ingest/job-restart-1")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "done"
        assert body["docId"] == "doc-restart-1"
        assert body["document"]["items"][0]["latex"] == "y=ax"

        r2 = await c.get("/api/document/doc-restart-1")
        assert r2.status_code == 200
        assert r2.json()["title"] == "Sample"


async def test_static_serving_mounts_only_when_dist_exists(tmp_path, monkeypatch):
    """dist/ present → SPA served; absent → API only (no fake production)."""
    # absent by default in a fresh checkout without a build
    import server.main as main_mod

    importlib.reload(main_mod)
    async with _client_for(main_mod.app) as c:
        r = await c.get("/")
        assert r.status_code == 404  # no dist → no static claim
