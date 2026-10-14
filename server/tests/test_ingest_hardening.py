"""Ingest hardening (architecture-defect round):
- latest-wins must REALLY cancel a running VLM job (the old supersede only
  killed the docling warm worker — a superseded VLM parse kept burning
  provider tokens on every remaining page until it finished on its own)
- PAPER2LAB_API_TOKEN (optional): when set, /api/* except health/ready
  requires the token — self-hosted deployments don't expose provider-burning
  parses / disk writes / engine execution to whoever finds the port

No credential literals: provider key values are env-derived placeholders.
"""
import asyncio
import os

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

PDF = b"%PDF-1.4\n%%EOF\n"
# non-empty, derived at runtime — the availability check requires a key to
# EXIST; its VALUE is never used (the parse is monkeypatched away)
_KEY_PLACEHOLDER = os.environ.get("PAPER2LAB_TEST_VLM_KEY") or f"placeholder-{os.getpid()}"


def _setenv(monkeypatch, **kv):
    for k in ("PAPER2LAB_TEST_CONVERT", "PAPER2LAB_API_TOKEN", "PAPER2LAB_AGENT_PROVIDER",
              "PAPER2LAB_AGENT_BASE_URL", "PAPER2LAB_AGENT_API_KEY", "PAPER2LAB_AGENT_MODEL"):
        monkeypatch.delenv(k, raising=False)
    for k, v in kv.items():
        monkeypatch.setenv(k, v)


class TestSupersedeCancelsVlm:
    @pytest.mark.asyncio
    async def test_running_vlm_job_is_cancelled_not_just_relabelled(self, monkeypatch):
        _setenv(monkeypatch,
                PAPER2LAB_AGENT_PROVIDER="openai",
                PAPER2LAB_AGENT_BASE_URL="https://vendor.example/v1",
                PAPER2LAB_AGENT_API_KEY=_KEY_PLACEHOLDER,
                PAPER2LAB_AGENT_MODEL="vision-model")
        import server.main as main_mod

        state = {"cancelled": False, "started": False}

        async def slow_parse(pdf_path, provider, on_stage=None):
            state["started"] = True
            try:
                await asyncio.sleep(600)  # a long multi-page vision parse
            except asyncio.CancelledError:
                state["cancelled"] = True  # the proof: the work REALLY stopped
                raise
            return {"docId": "never", "engine": "vlm", "doclingVersion": "x",
                    "title": "T", "pages": [{"page": 1, "width": 612, "height": 792}],
                    "items": []}

        monkeypatch.setattr(main_mod, "parse_pdf_with_vlm", slow_parse)
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                r1 = await client.post(
                    "/api/ingest", files={"file": ("a.pdf", PDF, "application/pdf")},
                    data={"mode": "vlm", "clientId": "c-cancel"})
                job1 = r1.json()["jobId"]
                for _ in range(80):
                    st = (await client.get(f"/api/ingest/{job1}")).json()
                    if st["status"] == "running":
                        break
                    await asyncio.sleep(0.1)
                assert state["started"], "fake parse never started"

                # same tab uploads again → job1 must be superseded AND cancelled
                r2 = await client.post(
                    "/api/ingest", files={"file": ("b.pdf", PDF, "application/pdf")},
                    data={"mode": "vlm", "clientId": "c-cancel"})
                assert r2.status_code == 202
                for _ in range(80):
                    st = (await client.get(f"/api/ingest/{job1}")).json()
                    if st["status"] == "superseded":
                        break
                    await asyncio.sleep(0.1)
                assert st["status"] == "superseded"
                # the cancellation actually reached the coroutine (not merely
                # a relabel while the gather kept running)
                for _ in range(80):
                    if state["cancelled"]:
                        break
                    await asyncio.sleep(0.1)
                assert state["cancelled"], "supersede relabelled the job but never cancelled the VLM work"


class TestOptionalApiToken:
    @pytest.mark.asyncio
    async def test_token_set_blocks_and_admits(self, monkeypatch):
        _setenv(monkeypatch, PAPER2LAB_API_TOKEN="test-guard-token", PAPER2LAB_TEST_CONVERT="1")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                # health/ready stay open (liveness probes must not need secrets)
                assert (await client.get("/api/health")).status_code == 200
                # no token → 401
                r = await client.post("/api/ingest", files={"file": ("p.pdf", PDF, "application/pdf")})
                assert r.status_code == 401
                # wrong token → 401
                r = await client.post(
                    "/api/ingest", files={"file": ("p.pdf", PDF, "application/pdf")},
                    headers={"Authorization": "Bearer wrong"})
                assert r.status_code == 401
                # right token (Bearer) → accepted
                r = await client.post(
                    "/api/ingest", files={"file": ("p.pdf", PDF, "application/pdf")},
                    headers={"Authorization": "Bearer test-guard-token"})
                assert r.status_code == 202
                # right token (X-API-Token header) → accepted
                r = await client.post(
                    "/api/ingest", files={"file": ("p.pdf", PDF, "application/pdf")},
                    headers={"X-API-Token": "test-guard-token"})
                assert r.status_code == 202
                # engine endpoints are guarded too
                assert (await client.post("/api/engine/execute", json={})).status_code == 401
                assert (await client.post(
                    "/api/engine/execute", json={}, headers={"X-API-Token": "test-guard-token"}
                )).status_code in (200, 422)  # past the gate; 422 = input validation

    @pytest.mark.asyncio
    async def test_token_unset_keeps_local_dev_open(self, monkeypatch):
        _setenv(monkeypatch, PAPER2LAB_TEST_CONVERT="1")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                r = await client.post("/api/ingest", files={"file": ("p.pdf", PDF, "application/pdf")})
                assert r.status_code == 202
