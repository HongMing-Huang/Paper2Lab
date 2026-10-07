"""#31: docling runs in a KILLABLE worker process — a timed-out conversion is
terminated (not haunting the executor pool), job states distinguish
queued/running/timeout/error, and the serialization slot frees truthfully."""
import asyncio
import os

import httpx
import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

PDF = b"%PDF-1.4\n%%EOF\n"


def _clear_test_hooks(monkeypatch):
    for name in ("PAPER2LAB_TEST_CONVERT", "PAPER2LAB_INGEST_ISOLATION", "PAPER2LAB_INGEST_TIMEOUT"):
        monkeypatch.delenv(name, raising=False)


async def _submit(client: AsyncClient, data: bytes = PDF) -> str:
    resp = await client.post(
        "/api/ingest",
        files={"file": ("paper.pdf", data, "application/pdf")},
    )
    assert resp.status_code == 202, resp.text
    return resp.json()["jobId"]


async def _wait_terminal(client: AsyncClient, job_id: str, timeout_s: float = 30.0) -> dict:
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout_s
    while loop.time() < deadline:
        st = (await client.get(f"/api/ingest/{job_id}")).json()
        if st["status"] in ("done", "error", "timeout"):
            return st
        await asyncio.sleep(0.25)
    pytest.fail(f"job {job_id} did not finish: {st}")


class TestProcessIsolation:
    @pytest.mark.asyncio
    async def test_hanging_worker_is_killed_with_distinct_timeout_status(self, monkeypatch, tmp_path):
        _clear_test_hooks(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "hang")
        monkeypatch.setenv("PAPER2LAB_INGEST_TIMEOUT", "2")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                job_id = await _submit(client)
                st = await _wait_terminal(client, job_id, timeout_s=15)
        assert st["status"] == "timeout"  # NOT "error" — terminated, distinct
        assert "killed" in st.get("error", "")

    @pytest.mark.asyncio
    async def test_timeout_frees_the_slot_next_job_runs_promptly(self, monkeypatch):
        _clear_test_hooks(monkeypatch)
        from server.main import INGEST_TIMEOUT_S

        monkeypatch.setenv("PAPER2LAB_INGEST_TIMEOUT", "2")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                # job 1 hangs (would hold a thread for 120s in the old mode)
                monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "hang")
                j1 = await _submit(client)
                # job 2 is healthy — after job1 is KILLED it must run promptly
                await asyncio.sleep(0.5)  # let job1 enter the slot
                monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "ok")
                j2 = await _submit(client)
                st2 = await _wait_terminal(client, j2, timeout_s=15)
                st1 = await _wait_terminal(client, j1, timeout_s=15)
        assert st2["status"] == "done"  # slot freed by the KILL, not by waiting
        assert st1["status"] == "timeout"

    @pytest.mark.asyncio
    async def test_job_is_queued_until_it_holds_the_slot(self, monkeypatch):
        _clear_test_hooks(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_INGEST_TIMEOUT", "3")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "hang")
                j1 = await _submit(client)
                await asyncio.sleep(0.6)  # job1 owns the docling slot now
                monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "ok")
                j2 = await _submit(client)
                st2 = (await client.get(f"/api/ingest/{j2}")).json()
                assert st2["status"] == "queued"  # truthful: waiting for the slot
                st2f = await _wait_terminal(client, j2, timeout_s=20)
                await _wait_terminal(client, j1, timeout_s=20)
        assert st2f["status"] == "done"

    @pytest.mark.asyncio
    async def test_crashing_worker_reports_error(self, monkeypatch):
        _clear_test_hooks(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "crash")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                job_id = await _submit(client)
                st = await _wait_terminal(client, job_id)
        assert st["status"] == "error"
        assert "worker failed" in st["error"]

    @pytest.mark.asyncio
    async def test_ok_worker_round_trips_result_json(self, monkeypatch):
        _clear_test_hooks(monkeypatch)
        monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "ok")
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                job_id = await _submit(client)
                st = await _wait_terminal(client, job_id)
        assert st["status"] == "done"
