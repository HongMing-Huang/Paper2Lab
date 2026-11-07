"""P1.1 — the versioned paper library surface: the existing upload entry now
feeds a paper/version list with per-upload provenance, and the ORIGINAL PDF
stays readable from the content-addressed store even while the parse is still
running or has failed."""
from __future__ import annotations

import hashlib
import io
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from server import db  # noqa: E402
from server.main import app  # noqa: E402
from server.tests import testtargets  # noqa: E402

TEST_DB_URL = testtargets.TEST_DATABASE  # J1.CI: the shared, guarded test target
PG_UP = False
try:
    import psycopg

    with psycopg.connect("postgresql://localhost:5432/postgres", connect_timeout=2) as _probe:
        PG_UP = True
except Exception:
    PG_UP = False

pytestmark = [pytest.mark.pg, pytest.mark.skipif(not PG_UP, reason="P1.1 needs a reachable local PostgreSQL")]

PDF = b"%PDF-1.4 p1 versioned-library payload " + b"p" * 64
PDF_B = b"%PDF-1.4 a DIFFERENT paper " + b"q" * 64


def _fixture_env(tmp_path, monkeypatch, convert_mode: str = "ok"):
    # J1.CI: the dedicated target must exist (CI creates it via POSTGRES_DB;
    # locally via createdb) — a loud, actionable error instead of a wedge
    testtargets.ensure_database()
    conn = db.connect(TEST_DB_URL)
    db.migrate(conn)
    conn.autocommit = True
    conn.execute("TRUNCATE upload_events, paper_versions, papers, artifacts, workspaces, parse_artifacts, documents")
    conn.autocommit = False
    conn.close()
    monkeypatch.setenv("PAPER2LAB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("PAPER2LAB_DATABASE_URL", TEST_DB_URL)
    monkeypatch.setenv("PAPER2LAB_DISABLE_STARTUP_WARMUP", "1")
    monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", convert_mode)
    import server.main as main_mod

    monkeypatch.setattr(main_mod, "DATA_DIR", tmp_path)
    return tmp_path


@pytest.fixture()
def env(tmp_path, monkeypatch):
    return _fixture_env(tmp_path, monkeypatch, "ok")


def _upload(client: TestClient, name: str, content: bytes = PDF) -> dict:
    res = client.post(
        "/api/ingest",
        files={"file": (name, io.BytesIO(content), "application/pdf")},
        data={"mode": "docling"},
    )
    assert res.status_code == 202, res.text
    return res.json()


def _wait_status(client: TestClient, job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/ingest/{job_id}").json()
        if body.get("status") in ("done", "error", "timeout"):
            return body
        time.sleep(0.05)
    return body


class TestPaperVersionList:
    def test_upload_lands_in_the_version_list_with_provenance(self, env):
        with TestClient(app) as client:
            submit = _upload(client, "list-me.pdf")
            _wait_status(client, submit["jobId"])
            listing = client.get("/api/papers").json()
        assert listing["repository"] is True
        papers = listing["papers"]
        assert len(papers) == 1
        paper = papers[0]
        assert paper["paper_id"] == submit["repo"]["paper_id"]
        assert paper["title_hint"] == "list-me"
        assert len(paper["versions"]) == 1
        version = paper["versions"][0]
        assert version["version_id"] == submit["repo"]["version_id"]
        assert version["sha256"] == hashlib.sha256(PDF).hexdigest()
        # 来源: one upload event per upload, with filename provenance
        assert len(version["uploads"]) == 1
        assert version["uploads"][0]["filename"] == "list-me.pdf"

    def test_same_file_twice_one_paper_two_uploads_in_the_list(self, env):
        with TestClient(app) as client:
            first = _upload(client, "one.pdf")
            _wait_status(client, first["jobId"])
            second = _upload(client, "two.pdf", PDF)
            _wait_status(client, second["jobId"])
            listing = client.get("/api/papers").json()
        assert len(listing["papers"]) == 1  # dedup: one paper
        version = listing["papers"][0]["versions"][0]
        assert len(version["uploads"]) == 2  # but BOTH uploads kept as 来源
        assert {u["filename"] for u in version["uploads"]} == {"one.pdf", "two.pdf"}

    def test_two_different_papers_list_separately(self, env):
        with TestClient(app) as client:
            a = _upload(client, "a.pdf", PDF)
            _wait_status(client, a["jobId"])
            b = _upload(client, "b.pdf", PDF_B)
            _wait_status(client, b["jobId"])
            listing = client.get("/api/papers").json()
        assert len(listing["papers"]) == 2

    def test_no_repository_configured_lists_empty_honestly(self, tmp_path, monkeypatch):
        monkeypatch.setenv("PAPER2LAB_DATA_DIR", str(tmp_path))
        monkeypatch.delenv("PAPER2LAB_DATABASE_URL", raising=False)
        monkeypatch.setenv("PAPER2LAB_DISABLE_STARTUP_WARMUP", "1")
        with TestClient(app) as client:
            listing = client.get("/api/papers").json()
        assert listing == {"repository": False, "papers": []}


class TestOriginalPdfReadable:
    def test_pdf_serves_while_the_parse_is_still_running(self, tmp_path, monkeypatch):
        _fixture_env(tmp_path, monkeypatch, "hang")
        with TestClient(app) as client:
            submit = _upload(client, "slow.pdf")
            body = client.get(f"/api/ingest/{submit['jobId']}").json()
            assert body["status"] in ("queued", "running")  # parse NOT done yet
            res = client.get(f"/api/papers/{submit['repo']['paper_id']}/pdf")
            assert res.status_code == 200
            assert res.content == PDF  # the ORIGINAL bytes, from the blob store

    def test_pdf_serves_after_the_parse_failed(self, tmp_path, monkeypatch):
        _fixture_env(tmp_path, monkeypatch, "crash")
        with TestClient(app) as client:
            submit = _upload(client, "boom.pdf")
            done = _wait_status(client, submit["jobId"], timeout=60.0)
            assert done["status"] in ("error", "timeout")
            res = client.get(f"/api/papers/{submit['repo']['paper_id']}/pdf")
            assert res.status_code == 200
            assert res.content == PDF

    def test_unknown_paper_pdf_is_404(self, env):
        with TestClient(app) as client:
            res = client.get("/api/papers/paper-nosuch/pdf")
        assert res.status_code == 404
