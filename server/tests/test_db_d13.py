"""D1.3 — the upload consumer's write authority switches to PostgreSQL:
persist_doc writes the parse result to the documents table ONLY (no dual
write to doc-*.json), reads serve from PG with the legacy JSON files as a
read-only fallback for pre-switch docs, and a full export/restore drill
verifies the repository can be recovered after a wipe with counts intact."""
from __future__ import annotations

import hashlib
import io
import json
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from server import db  # noqa: E402
from server.db_export import export_repo, restore_repo  # noqa: E402
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

pytestmark = [pytest.mark.pg, pytest.mark.skipif(not PG_UP, reason="D1.3 needs a reachable local PostgreSQL")]

PDF = b"%PDF-1.4 d13 authority-switch payload " + b"y" * 64


def _wait_done(client: TestClient, job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/ingest/{job_id}").json()
        if body.get("status") in ("done", "error", "timeout"):
            return body
        time.sleep(0.1)
    raise AssertionError("job did not settle")


@pytest.fixture()
def db_env(tmp_path, monkeypatch):
    # J1.CI: the dedicated target must exist (CI creates it via POSTGRES_DB;
    # locally via createdb) — a loud, actionable error instead of a wedge
    testtargets.ensure_database()
    conn = db.connect(TEST_DB_URL)
    db.migrate(conn)
    conn.autocommit = True
    conn.execute("TRUNCATE upload_events, paper_versions, papers, artifacts, workspaces, documents, parse_artifacts")
    conn.autocommit = False
    conn.close()
    monkeypatch.setenv("PAPER2LAB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("PAPER2LAB_DATABASE_URL", TEST_DB_URL)
    monkeypatch.setenv("PAPER2LAB_DISABLE_STARTUP_WARMUP", "1")
    monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "ok")
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


class TestWriteAuthoritySwitch:
    def test_doc_lands_in_pg_only_no_json_dual_write(self, db_env):
        with TestClient(app) as client:
            submit = _upload(client, "authority.pdf")
            done = _wait_done(client, submit["jobId"])
        assert done["status"] == "done", done
        doc_id = done["docId"]
        # the document IS in the repository
        conn = db.connect(TEST_DB_URL)
        with conn.cursor() as cur:
            cur.execute("SELECT doc_id, provenance, doc_json FROM documents WHERE doc_id = %(d)s", {"d": doc_id})
            row = cur.fetchone()
        assert row is not None and row["provenance"] == "pg-authority"
        assert row["doc_json"]["docId"] == doc_id
        # and the legacy JSON file was NOT written — single write authority
        assert not (db_env / f"doc-{doc_id}.json").exists()
        # /api/document serves from the repository
        with TestClient(app) as client:
            got = client.get(f"/api/document/{doc_id}")
        assert got.status_code == 200 and got.json()["docId"] == doc_id
        conn.close()

    def test_legacy_json_docs_remain_readable_read_only_fallback(self, db_env):
        legacy = {"docId": "doc-legacy01", "engine": "docling", "title": "old world", "items": []}
        (db_env / "doc-doc-legacy01.json").write_text(json.dumps(legacy))
        with TestClient(app) as client:
            got = client.get("/api/document/doc-legacy01")
        assert got.status_code == 200 and got.json()["title"] == "old world"
        # and a fresh parse under the SAME authority still goes to PG only
        with TestClient(app) as client:
            submit = _upload(client, "fresh.pdf")
            done = _wait_done(client, submit["jobId"])
        assert done["status"] == "done"
        assert not (db_env / f"doc-{done['docId']}.json").exists()

    def test_no_db_configured_keeps_the_json_path_unchanged(self, tmp_path, monkeypatch):
        monkeypatch.setenv("PAPER2LAB_DATA_DIR", str(tmp_path))
        monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "ok")
        monkeypatch.setenv("PAPER2LAB_DISABLE_STARTUP_WARMUP", "1")
        monkeypatch.delenv("PAPER2LAB_DATABASE_URL", raising=False)
        import server.main as main_mod

        monkeypatch.setattr(main_mod, "DATA_DIR", tmp_path)
        with TestClient(app) as client:
            submit = _upload(client, "oldworld.pdf")
            done = _wait_done(client, submit["jobId"])
        assert done["status"] == "done"
        assert (tmp_path / f"doc-{done['docId']}.json").exists()  # legacy write path intact

    def test_pg_failure_at_persist_does_not_fallback_to_json(self, db_env, monkeypatch):
        # the D1.1 repo round-trip already failed visibly; now make the DOC
        # write fail too: point the URL at a database that cannot exist
        monkeypatch.setenv("PAPER2LAB_DATABASE_URL", "postgresql://localhost:5432/no_such_db_d13")
        with TestClient(app) as client:
            submit = _upload(client, "pgdown.pdf")
            done = _wait_done(client, submit["jobId"])
        # the parse may complete but the doc must NOT be silently written to JSON
        assert not any(p.name.startswith("doc-doc-") for p in db_env.glob("doc-*.json"))
        # and the failure is VISIBLE on the job — never silent
        assert isinstance(done.get("repo"), dict) and "error" in done["repo"], done


class TestExportRecoveryDrill:
    def test_export_wipe_restore_verifies_counts_and_serves_docs(self, db_env, tmp_path):
        # produce REAL data through the consumer (two uploads of the SAME
        # bytes → same paper/version, two upload_events rows)
        with TestClient(app) as client:
            first = _upload(client, "one.pdf")
            d1 = _wait_done(client, first["jobId"])
            second = _upload(client, "again.pdf")
            _wait_done(client, second["jobId"])
        doc_id = d1["docId"]

        conn = db.connect(TEST_DB_URL)
        dump_path = tmp_path / "repo-export.json"
        exported = export_repo(conn, dump_path)
        assert exported["documents"] >= 1
        assert exported["upload_events"] >= 2  # two uploads of the same bytes

        # WIPE the domain tables (simulated disaster) and restore
        conn.rollback()  # release the export's read transaction first
        conn.autocommit = True
        conn.execute("TRUNCATE upload_events, paper_versions, papers, artifacts, workspaces, documents, parse_artifacts")
        conn.autocommit = False
        restored = restore_repo(conn, dump_path)
        assert restored == exported  # counts round-trip exactly

        # the document is served again from the restored repository
        with TestClient(app) as client:
            got = client.get(f"/api/document/{doc_id}")
        assert got.status_code == 200 and got.json()["docId"] == doc_id
        conn.close()
