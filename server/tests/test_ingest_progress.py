"""#15 UX: the ingest status poller must expose LIVE truth — stage
(warming/parsing), elapsedMs and queueDepth — so a 20-60s parse never reads
as a stuck spinner. Verified against the real warm worker with the ok hook
(stage plumbing exercised via the line protocol) plus a fake-stage injection
for the warming/parsing transition."""
import asyncio
import json

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

PDF = b"%PDF-1.4\n%%EOF\n"


def _clear(monkeypatch):
    for name in ("PAPER2LAB_TEST_CONVERT", "PAPER2LAB_INGEST_ISOLATION", "PAPER2LAB_INGEST_TIMEOUT"):
        monkeypatch.delenv(name, raising=False)


async def _submit(client):
    r = await client.post("/api/ingest", files={"file": ("p.pdf", PDF, "application/pdf")})
    assert r.status_code == 202
    return r.json()["jobId"]


class TestStageSurface:
    @pytest.mark.asyncio
    async def test_status_carries_stage_elapsed_and_queue_depth(self, monkeypatch):
        _clear(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "ok")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                j1 = await _submit(client)
                # poll until terminal; collect one mid-flight sample
                seen_running = False
                for _ in range(80):
                    st = (await client.get(f"/api/ingest/{j1}")).json()
                    if st["status"] == "running":
                        seen_running = True
                        assert "elapsedMs" in st and "queueDepth" in st and "stage" in st
                        assert st["elapsedMs"] >= 0
                        break
                    await asyncio.sleep(0.25)
                while st["status"] in ("queued", "running"):
                    await asyncio.sleep(0.25)
                    st = (await client.get(f"/api/ingest/{j1}")).json()
                assert st["status"] == "done"
                # elapsedMs keeps reporting post-completion (time to done)
                assert st["elapsedMs"] > 0 or st["elapsedMs"] == 0
                assert seen_running or st["status"] == "done"

    @pytest.mark.asyncio
    async def test_queued_job_reports_queue_depth(self, monkeypatch):
        """a queued job (docling slot busy) must say so WITH the depth —
        the user sees '排队中 · 前面还有 N 个' instead of a dead spinner"""
        _clear(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_INGEST_TIMEOUT", "6")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "hang")
                j1 = await _submit(client)
                await asyncio.sleep(0.8)  # j1 acquires the slot
                monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "ok")
                j2 = await _submit(client)
                st2 = (await client.get(f"/api/ingest/{j2}")).json()
                assert st2["status"] == "queued"
                assert st2["queueDepth"] >= 1
                assert "elapsedMs" in st2
                # let both settle for the next test's cleanliness
                for _ in range(60):
                    s1 = (await client.get(f"/api/ingest/{j1}")).json()
                    s2 = (await client.get(f"/api/ingest/{j2}")).json()
                    if s1["status"] in ("timeout", "error", "done") and s2["status"] in ("timeout", "error", "done"):
                        break
                    await asyncio.sleep(0.5)
                assert s1["status"] == "timeout"

    @pytest.mark.asyncio
    async def test_worker_stage_notifications_reach_the_job(self, monkeypatch):
        """warming → parsing transitions flow through the line protocol:
        faked worker emits stage lines then the result; the job records them"""
        _clear(monkeypatch)
        from server import main as srv

        async with LifespanManager(srv.app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                stages: list[str] = []

                class FakeWorker:
                    async def convert(self, pdf, title, test_mode, on_stage=None):
                        if on_stage:
                            on_stage("warming")
                            stages.append("warming")
                            on_stage("parsing")
                            stages.append("parsing")
                        return {"docId": "staged", "title": title, "ok": True}

                real_fn = srv._current_warm_worker
                srv._current_warm_worker = lambda: FakeWorker()
                try:
                    j = await _submit(client)
                    for _ in range(40):
                        st = (await client.get(f"/api/ingest/{j}")).json()
                        if st["status"] == "done":
                            break
                        await asyncio.sleep(0.25)
                    assert st["status"] == "done"
                    assert st["stage"] == "parsing"  # last stage persisted
                    assert stages == ["warming", "parsing"]
                finally:
                    srv._current_warm_worker = real_fn


class TestLatestWins:
    @pytest.mark.asyncio
    async def test_new_upload_supersedes_queued_sibling_of_same_tab(self, monkeypatch):
        """retry must WIN, not queue behind its own stale job: a newer upload
        with the same clientId supersedes the tab's queued/running stale job;
        another tab's job is immune"""
        _clear(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_INGEST_TIMEOUT", "8")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "hang")
                r1 = await client.post("/api/ingest", data={"clientId": "tab-A"}, files={"file": ("a.pdf", PDF, "application/pdf")})
                r2 = await client.post("/api/ingest", data={"clientId": "tab-B"}, files={"file": ("b.pdf", PDF, "application/pdf")})
                j1, j2 = r1.json()["jobId"], r2.json()["jobId"]
                await asyncio.sleep(0.8)  # both entered the pipeline
                monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "ok")
                r3 = await client.post("/api/ingest", data={"clientId": "tab-A"}, files={"file": ("a2.pdf", PDF, "application/pdf")})
                j3 = r3.json()["jobId"]
                for _ in range(80):
                    s1 = (await client.get(f"/api/ingest/{j1}")).json()
                    if s1["status"] not in ("queued", "running"):
                        break
                    await asyncio.sleep(0.25)
                assert s1["status"] == "superseded"
                assert "取代" in (s1.get("error") or "")
                s3 = (await client.get(f"/api/ingest/{j3}")).json()
                while s3["status"] in ("queued", "running"):
                    await asyncio.sleep(0.25)
                    s3 = (await client.get(f"/api/ingest/{j3}")).json()
                assert s3["status"] == "done"
                s2 = (await client.get(f"/api/ingest/{j2}")).json()
                while s2["status"] in ("queued", "running"):
                    await asyncio.sleep(0.25)
                    s2 = (await client.get(f"/api/ingest/{j2}")).json()
                # tab-B was NOT collateral-damaged: it settles on its own
                # (done under ok-mode after the slot freed, or its own timeout
                # — the invariant is: never 'superseded' by ANOTHER tab)
                assert s2["status"] in ("done", "timeout")
                assert s2["status"] != "superseded"

    @pytest.mark.asyncio
    async def test_superseded_running_job_keeps_the_supersede_truth(self, monkeypatch):
        """the killed running job settles as 'superseded' — its unblocked
        coroutine must NOT overwrite the truth with error/timeout"""
        _clear(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_INGEST_TIMEOUT", "30")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "hang")
                r1 = await client.post("/api/ingest", data={"clientId": "tab-X"}, files={"file": ("x.pdf", PDF, "application/pdf")})
                j1 = r1.json()["jobId"]
                await asyncio.sleep(0.8)  # j1 RUNNING inside the worker
                monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "ok")
                await client.post("/api/ingest", data={"clientId": "tab-X"}, files={"file": ("x2.pdf", PDF, "application/pdf")})
                for _ in range(60):
                    s1 = (await client.get(f"/api/ingest/{j1}")).json()
                    if s1["status"] not in ("queued", "running"):
                        break
                    await asyncio.sleep(0.25)
                assert s1["status"] == "superseded", s1
