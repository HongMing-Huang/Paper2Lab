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


class TestVlmAdmissionAndQueue:
    """process-wide VLM admission (review finding): the per-job 4-page
    semaphore never bounded SERVER-wide work — N uploads issued 4×N provider
    calls. The shared gate must (a) hold extra jobs queued and (b) let a
    queued superseded job be CANCELLED, not resurrect to running when its
    slot finally frees."""

    def _fake_slow(self, main_mod, started: dict, duration: float = 600.0):
        async def slow_parse(pdf_path, provider, on_stage=None):
            started[pdf_path] = True
            try:
                await asyncio.sleep(duration)
            except asyncio.CancelledError:
                started[f"{pdf_path}:cancelled"] = True
                raise
            return {"docId": "vlm-x", "engine": "vlm", "doclingVersion": "x",
                    "title": "T", "pages": [{"page": 1, "width": 612, "height": 792}],
                    "items": [{"id": "p1-i0", "kind": "text", "page": 1,
                               "bbox": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.05}, "text": "hi"}]}

        return slow_parse

    async def _wait_status(self, client, job_id, want, tries=100):
        for _ in range(tries):
            st = (await client.get(f"/api/ingest/{job_id}")).json()
            if st["status"] == want:
                return st
            await asyncio.sleep(0.05)
        return st

    @pytest.mark.asyncio
    async def test_second_vlm_job_waits_then_queued_supersede_cancels(self, monkeypatch):
        _setenv(monkeypatch,
                PAPER2LAB_AGENT_PROVIDER="openai",
                PAPER2LAB_AGENT_BASE_URL="https://vendor.example/v1",
                PAPER2LAB_AGENT_API_KEY=_KEY_PLACEHOLDER,
                PAPER2LAB_AGENT_MODEL="vision-model",
                PAPER2LAB_MAX_VLM_JOBS="1")
        import server.main as main_mod
        from server.main import app

        started: dict = {}
        monkeypatch.setattr(main_mod, "parse_pdf_with_vlm", self._fake_slow(main_mod, started))

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                # job A (client-1) takes the only VLM slot
                a = (await client.post("/api/ingest", files={"file": ("a.pdf", PDF, "application/pdf")},
                                       data={"mode": "vlm", "clientId": "c1"})).json()["jobId"]
                await self._wait_status(client, a, "running")
                # job B (client-2) must stay QUEUED behind the gate
                b = (await client.post("/api/ingest", files={"file": ("b.pdf", PDF, "application/pdf")},
                                       data={"mode": "vlm", "clientId": "c2"})).json()["jobId"]
                st_b = await self._wait_status(client, b, "running", tries=20)  # short wait: stays queued
                assert st_b["status"] == "queued", "admission gate must hold job B queued while A runs"
                assert "b.pdf" not in started
                # client-2 retries: B is superseded while QUEUED — it must be
                # cancelled, never resurrect to running later
                c = (await client.post("/api/ingest", files={"file": ("c.pdf", PDF, "application/pdf")},
                                       data={"mode": "vlm", "clientId": "c2"})).json()["jobId"]
                st_b = await self._wait_status(client, b, "superseded")
                assert st_b["status"] == "superseded"
                # and the queued coroutine for B never starts work
                await asyncio.sleep(0.3)
                assert "b.pdf" not in started


class TestOverLimitRejection:
    @pytest.mark.asyncio
    async def test_long_paper_rejected_with_actionable_guidance(self, monkeypatch, tmp_path):
        _setenv(monkeypatch,
                PAPER2LAB_AGENT_PROVIDER="openai",
                PAPER2LAB_AGENT_BASE_URL="https://vendor.example/v1",
                PAPER2LAB_AGENT_API_KEY=_KEY_PLACEHOLDER,
                PAPER2LAB_AGENT_MODEL="vision-model")
        from pypdf import PdfReader, PdfWriter

        from server.vlm_parse import _MAX_PAGES

        reader = PdfReader("public/papers/ode-lotka-volterra.pdf")
        writer = PdfWriter()
        for _ in range(_MAX_PAGES + 1):
            writer.add_page(reader.pages[0])
        long_pdf = tmp_path / "long.pdf"
        with long_pdf.open("wb") as fh:
            writer.write(fh)

        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                r = await client.post(
                    "/api/ingest",
                    files={"file": ("long.pdf", long_pdf.read_bytes(), "application/pdf")},
                    data={"mode": "vlm"},
                )
                job = r.json()["jobId"]
                for _ in range(60):
                    st = (await client.get(f"/api/ingest/{job}")).json()
                    if st["status"] in ("error", "done", "timeout"):
                        break
                    await asyncio.sleep(0.25)
                assert st["status"] == "error"
                assert "精读定位" in st["error"]  # the actionable alternative, in-band
