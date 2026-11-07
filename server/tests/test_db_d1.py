"""D1.1 — the minimal PostgreSQL migration behind the REAL upload consumer:
content-addressed artifacts (sha256 blob store), Paper/Version identity with
workspace scoping, and same-file dedup. The JSON/JSONL path remains the write
authority until D1.3 — D1.1 only adds the real database round-trip.

One FIXED test database (paper2lab_d11_test) is shared; tests isolate by
truncating the domain tables in the fixture — no dynamic identifiers."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from server.db import (  # noqa: E402
    connect,
    migrate,
    ensure_workspace,
    store_paper_upload,
    get_paper_by_sha,
    artifact_bytes,
)

from server.tests import testtargets  # noqa: E402

TEST_DB_URL = testtargets.TEST_DATABASE  # J1.CI: the shared, guarded test target
ADMIN_URL = "postgresql://localhost:5432/postgres"

PG_UP = False
try:
    import psycopg

    with psycopg.connect(ADMIN_URL, connect_timeout=2) as _probe:
        PG_UP = True
except Exception:
    PG_UP = False

pytestmark = [pytest.mark.pg, pytest.mark.skipif(not PG_UP, reason="D1.1 needs a reachable local PostgreSQL")]


@pytest.fixture()
def db(tmp_path):
    import psycopg

    # J1.CI: the dedicated target must exist (CI creates it via POSTGRES_DB;
    # locally via createdb) — admin URL derives from the TARGET's server
    testtargets.ensure_database()
    conn = connect(TEST_DB_URL)
    migrate(conn)
    conn.autocommit = True
    conn.execute("TRUNCATE upload_events, paper_versions, papers, artifacts, workspaces, parse_artifacts")
    conn.autocommit = False
    yield conn, TEST_DB_URL, tmp_path
    conn.close()


PDF = b"%PDF-1.4 minimal test payload"


class TestWorkspaceIdentity:
    def test_ensure_workspace_is_idempotent(self, db):
        conn, _, _ = db
        ws = ensure_workspace(conn, "default")
        again = ensure_workspace(conn, "default")
        assert ws == again  # same row, not a duplicate


class TestContentAddressedRoundTrip:
    def test_upload_stores_artifact_paper_version_and_reads_back(self, db):
        conn, _, storage = db
        ensure_workspace(conn, "default")
        sha = hashlib.sha256(PDF).hexdigest()
        rec = store_paper_upload(conn, workspace="default", filename="paper-a.pdf", content=PDF, storage_root=storage)
        assert rec["sha256"] == sha
        assert rec["paper_id"] and rec["version_id"]
        # the blob round-trips byte-for-byte from the content-addressed store
        assert artifact_bytes(rec["artifact_sha256"], storage_root=storage) == PDF
        # the identity index reads back by (workspace, sha)
        got = get_paper_by_sha(conn, workspace="default", sha256=sha)
        assert got is not None and got["id"] == rec["paper_id"]
        assert got["title_hint"] == "paper-a"

    def test_same_file_twice_dedups_to_one_version_but_keeps_both_uploads(self, db):
        conn, _, storage = db
        ensure_workspace(conn, "default")
        first = store_paper_upload(conn, workspace="default", filename="a.pdf", content=PDF, storage_root=storage)
        second = store_paper_upload(conn, workspace="default", filename="b.pdf", content=PDF, storage_root=storage)
        assert first["paper_id"] == second["paper_id"]  # one paper per (workspace, content)
        assert first["version_id"] == second["version_id"]  # same bytes → same version
        assert first["artifact_sha256"] == second["artifact_sha256"]
        # but the provenance of each upload is preserved (P1's per-source rows)
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM upload_events WHERE version_id = %s", (first["version_id"],))
            assert cur.fetchone()["n"] == 2

    def test_different_workspaces_keep_separate_papers_for_the_same_bytes(self, db):
        conn, _, storage = db
        ensure_workspace(conn, "ws-a")
        ensure_workspace(conn, "ws-b")
        a = store_paper_upload(conn, workspace="ws-a", filename="x.pdf", content=PDF, storage_root=storage)
        b = store_paper_upload(conn, workspace="ws-b", filename="x.pdf", content=PDF, storage_root=storage)
        assert a["paper_id"] != b["paper_id"]  # identity is workspace-scoped
        assert a["artifact_sha256"] == b["artifact_sha256"]  # the blob store is global


class TestMigration:
    def test_migrate_is_idempotent_and_versioned(self, db):
        conn, _, _ = db
        migrate(conn)  # second run must be a no-op, not an error
        with conn.cursor() as cur:
            cur.execute("SELECT max(version) FROM schema_migrations")
            assert cur.fetchone()["max"] >= 1
