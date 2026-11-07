"""D1.2 — read-only import of the legacy JSON/JSONL snapshots into the
repository: doc-*.json parse results and engine-runs.jsonl Run records.
Original IDs are preserved, provenance is stamped legacy (never silently
upgraded), the import is repeatable (idempotent, zero new Runs), and the
imported count + content hashes are verifiable."""
from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from server.db import connect, migrate  # noqa: E402
from server.db_import import import_doc_snapshots, import_run_log, import_report  # noqa: E402
from server.tests import testtargets  # noqa: E402

TEST_DB_URL = testtargets.TEST_DATABASE  # J1.CI: the shared, guarded test target

PG_UP = False
try:
    import psycopg

    with psycopg.connect("postgresql://localhost:5432/postgres", connect_timeout=2) as _probe:
        PG_UP = True
except Exception:
    PG_UP = False

pytestmark = [pytest.mark.pg, pytest.mark.skipif(not PG_UP, reason="D1.2 needs a reachable local PostgreSQL")]


@pytest.fixture()
def db():
    # J1.CI: the dedicated target must exist (CI creates it via POSTGRES_DB;
    # locally via createdb) — a loud, actionable error instead of a wedge
    testtargets.ensure_database()
    conn = connect(TEST_DB_URL)
    migrate(conn)
    conn.autocommit = True
    conn.execute("TRUNCATE imported_docs, imported_runs")
    conn.autocommit = False
    yield conn
    conn.close()


def _doc_file(tmp: Path, doc_id: str) -> Path:
    doc = {
        "docId": doc_id,
        "engine": "docling",
        "doclingVersion": "2.131.0",
        "title": "sample",
        "pages": [{"page": 1, "width": 612.0, "height": 792.0}],
        "items": [{"id": "p1-i0", "kind": "text", "page": 1, "bbox": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.02}, "text": "hello"}],
    }
    p = tmp / f"doc-{doc_id}.json"
    p.write_text(json.dumps(doc, ensure_ascii=False))
    return p


def _run_line(run_id: str, status: str = "resolved") -> str:
    run = {
        "runId": run_id,
        "spec": {"kind": "formula.value", "params": {}, "seed": 0, "model": {"expression": ["Sin", "x"], "bindings": {"x": 1}}},
        "status": status,
        "result": {"value": 0.8414709848078965} if status == "resolved" else None,
        "engine": "cortex-ce-js",
        "engineVersion": "0.142.0",
        "durationMs": 0,
        "evidence": "CALCULATED",
        "createdAt": 1791300019956,
        "startedAt": 1791300019956,
        "errors": [],
    }
    return json.dumps(run, ensure_ascii=False)


class TestDocImport:
    def test_imports_every_doc_preserving_ids_and_legacy_provenance(self, db, tmp_path):
        _doc_file(tmp_path, "doc-aaa111")
        _doc_file(tmp_path, "doc-bbb222")
        report = import_doc_snapshots(db, tmp_path)
        assert report.imported == 2
        with db.cursor() as cur:
            cur.execute("SELECT doc_id, provenance, content_sha256 FROM imported_docs ORDER BY doc_id")
            rows = cur.fetchall()
        assert [r["doc_id"] for r in rows] == ["doc-aaa111", "doc-bbb222"]  # ORIGINAL ids
        assert all(r["provenance"] == "legacy-json" for r in rows)  # never upgraded silently
        # content hash is verifiable against the source file
        raw = (tmp_path / "doc-doc-aaa111.json").read_bytes()
        assert rows[0]["content_sha256"] == "sha256:" + hashlib.sha256(raw).hexdigest()

    def test_reimport_is_idempotent_zero_duplicates(self, db, tmp_path):
        _doc_file(tmp_path, "doc-aaa111")
        first = import_doc_snapshots(db, tmp_path)
        second = import_doc_snapshots(db, tmp_path)
        assert first.imported == 1 and second.imported == 0
        assert second.skipped == 1
        with db.cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM imported_docs")
            assert cur.fetchone()["n"] == 1

    def test_a_changed_file_under_a_known_id_is_reported_not_overwritten(self, db, tmp_path):
        p = _doc_file(tmp_path, "doc-aaa111")
        original_raw = p.read_bytes()
        original_sha = "sha256:" + hashlib.sha256(original_raw).hexdigest()
        import_doc_snapshots(db, tmp_path)
        p.write_text(json.dumps({"docId": "doc-aaa111", "title": "tampered"}))
        report = import_doc_snapshots(db, tmp_path)
        assert report.conflicts == 1
        with db.cursor() as cur:
            cur.execute("SELECT content_sha256 FROM imported_docs WHERE doc_id = 'doc-aaa111'")
            stored = cur.fetchone()["content_sha256"]
        # POSITIVE: the row still carries the ORIGINAL file's hash — not overwritten
        assert stored == original_sha
        tampered_sha = "sha256:" + hashlib.sha256(json.dumps({"docId": "doc-aaa111", "title": "tampered"}).encode()).hexdigest()
        assert stored != tampered_sha

    def test_malformed_json_is_counted_not_fatal(self, db, tmp_path):
        _doc_file(tmp_path, "doc-aaa111")
        (tmp_path / "doc-bad.json").write_text("{not json")
        report = import_doc_snapshots(db, tmp_path)
        assert report.imported == 1 and report.errors == 1


class TestRunImport:
    def test_imports_runs_by_original_id_without_recomputing(self, db, tmp_path):
        log = tmp_path / "engine-runs.jsonl"
        log.write_text(_run_line("formula-value-x1") + "\n" + _run_line("formula-value-x2") + "\n")
        report = import_run_log(db, log)
        assert report.imported == 2
        with db.cursor() as cur:
            cur.execute("SELECT run_id, status, result_json FROM imported_runs ORDER BY run_id")
            rows = cur.fetchall()
        assert [r["run_id"] for r in rows] == ["formula-value-x1", "formula-value-x2"]
        assert all(r["status"] == "resolved" for r in rows)
        # the numbers are the LEGACY snapshot's, byte-identical — no recompute
        # (psycopg parses JSONB columns to dicts already)
        assert rows[0]["result_json"] == {"value": 0.8414709848078965}

    def test_reimport_is_idempotent_and_error_runs_import_too(self, db, tmp_path):
        log = tmp_path / "engine-runs.jsonl"
        log.write_text(_run_line("formula-value-x1") + "\n" + _run_line("formula-value-err", status="error") + "\n")
        first = import_run_log(db, log)
        second = import_run_log(db, log)
        assert first.imported == 2 and second.imported == 0 and second.skipped == 2
        with db.cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM imported_runs")
            assert cur.fetchone()["n"] == 2  # zero NEW rows — repeatable

    def test_corrupt_tail_line_loses_only_itself(self, db, tmp_path):
        log = tmp_path / "engine-runs.jsonl"
        log.write_text(_run_line("formula-value-x1") + "\n" + '{"runId":"cut-off","spec":{"kind"\n')
        report = import_run_log(db, log)
        assert report.imported == 1 and report.errors == 1


class TestReport:
    def test_the_report_carries_verifiable_hashes(self, db, tmp_path):
        _doc_file(tmp_path, "doc-aaa111")
        log = tmp_path / "engine-runs.jsonl"
        log.write_text(_run_line("formula-value-x1") + "\n")
        docs = import_doc_snapshots(db, tmp_path)
        runs = import_run_log(db, log)
        combined = import_report(docs, runs)
        assert combined["docs"]["imported"] == 1 and combined["runs"]["imported"] == 1
        # the source hashes are in the report for independent verification
        assert combined["docs"]["sources"][0]["sha256"].startswith("sha256:")
        assert combined["runs"]["source"]["sha256"].startswith("sha256:")
