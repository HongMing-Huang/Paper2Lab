"""D1.1 — the REAL upload consumer's database round-trip: POST /api/ingest
with PAPER2LAB_DATABASE_URL configured stores the content-addressed artifact
and workspace-scoped Paper/Version rows, the job JSON carries the repo record,
a same-file re-upload dedups to the same version, and a repository failure is
recorded on the job instead of being silent. Without the env the endpoint
behaves exactly as before (opt-in until D1.3)."""
from __future__ import annotations

import hashlib
import io
import sys
import uuid
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

pytestmark = [pytest.mark.pg, pytest.mark.skipif(not PG_UP, reason="D1.1 needs a reachable local PostgreSQL")]

PDF = b"%PDF-1.4 consumer round-trip payload " + b"x" * 64


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """isolated DATA_DIR + the repository configured + a clean schema"""
    # J1.CI: the dedicated target must exist (CI creates it via POSTGRES_DB;
    # locally via createdb) — a loud, actionable error instead of a wedge
    testtargets.ensure_database()
    conn = db.connect(TEST_DB_URL)
    db.migrate(conn)
    conn.autocommit = True
    conn.execute("TRUNCATE upload_events, paper_versions, papers, artifacts, workspaces, parse_artifacts")
    conn.autocommit = False
    conn.close()
    monkeypatch.setenv("PAPER2LAB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("PAPER2LAB_DATABASE_URL", TEST_DB_URL)
    monkeypatch.setenv("PAPER2LAB_DISABLE_STARTUP_WARMUP", "1")
    # DATA_DIR is read at import time — repoint the module global too, so the
    # content-addressed store lands in THIS test's directory
    import server.main as main_mod

    monkeypatch.setattr(main_mod, "DATA_DIR", tmp_path)
    return tmp_path


def _upload(client: TestClient, name: str) -> dict:
    res = client.post(
        "/api/ingest",
 files={"file": (name, io.BytesIO(PDF), "application/pdf")},
        data={"mode": "docling"},
    )
    assert res.status_code == 202, res.text
    return res.json()


class TestConsumerRoundTrip:
    def test_upload_writes_artifact_paper_version_and_job_carries_the_record(self, env):
        with TestClient(app) as client:
            body = _upload(client, "consumer.pdf")
        sha = hashlib.sha256(PDF).hexdigest()
        assert body["repo"]["sha256"] == sha
        assert body["repo"]["readback_ok"] is True
        assert body["repo"]["paper_id"] and body["repo"]["version_id"]
        # the blob is in the content-addressed store under DATA_DIR
        assert (env / "artifacts" / sha[:2] / sha).read_bytes() == PDF
        # and the identity index reads back
        conn = db.connect(TEST_DB_URL)
        got = db.get_paper_by_sha(conn, workspace="default", sha256=sha)
        conn.close()
        assert got is not None and got["id"] == body["repo"]["paper_id"]

    def test_same_file_reupload_dedups_to_one_version_with_two_events(self, env):
        with TestClient(app) as client:
            first = _upload(client, "a.pdf")
            second = _upload(client, "b.pdf")
        assert first["repo"]["version_id"] == second["repo"]["version_id"]
        assert first["repo"]["paper_id"] == second["repo"]["paper_id"]
        import psycopg

        with psycopg.connect(TEST_DB_URL) as conn:
            row = conn.execute(
                "SELECT count(*) FROM upload_events WHERE version_id = %s",
                (first["repo"]["version_id"],),
            ).fetchone()
            assert row[0] == 2

    def test_repository_failure_is_recorded_not_silent(self, env, monkeypatch):
        # break the URL AFTER the env is set: connect fails, the job must
        # carry repo.error and the endpoint still answers 200 with a jobId
        monkeypatch.setenv("PAPER2LAB_DATABASE_URL", "postgresql://localhost:5432/no_such_db_d1")
        with TestClient(app) as client:
            res = client.post(
                "/api/ingest",
 files={"file": ("boom.pdf", io.BytesIO(PDF), "application/pdf")},
                data={"mode": "docling"},
            )
        assert res.status_code == 202
        body = res.json()
        assert body["repo"]["error"]

    def test_without_the_env_the_repo_field_stays_absent(self, tmp_path, monkeypatch):
        monkeypatch.setenv("PAPER2LAB_DATA_DIR", str(tmp_path))
        monkeypatch.delenv("PAPER2LAB_DATABASE_URL", raising=False)
        monkeypatch.setenv("PAPER2LAB_DISABLE_STARTUP_WARMUP", "1")
        with TestClient(app) as client:
            res = client.post(
                "/api/ingest",
 files={"file": ("plain.pdf", io.BytesIO(PDF), "application/pdf")},
                data={"mode": "docling"},
            )
        assert res.status_code == 202
        assert res.json()["repo"] is None
