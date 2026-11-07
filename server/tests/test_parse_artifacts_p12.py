"""P1.2 — parse artifacts are versioned with parser identity and anchor
precision: every parse lands as an append-only parse_artifacts row (parser
name/version, anchorPrecision region|page derived from the engine), a
re-parse of the same paper adds a NEW artifact, and old artifacts stay
openable with their ORIGINAL precision (page-level never silently upgraded
to region)."""
from __future__ import annotations

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
from server.parse_store import anchor_precision_for as _anchor_precision_for  # noqa: E402
from server.tests import testtargets  # noqa: E402

TEST_DB_URL = testtargets.TEST_DATABASE  # J1.CI: the shared, guarded test target
PG_UP = False
try:
    import psycopg

    with psycopg.connect("postgresql://localhost:5432/postgres", connect_timeout=2) as _probe:
        PG_UP = True
except Exception:
    PG_UP = False

pytestmark = [pytest.mark.pg, pytest.mark.skipif(not PG_UP, reason="P1.2 needs a reachable local PostgreSQL")]

PDF = b"%PDF-1.4 p1.2 parse-artifact payload " + b"r" * 64


@pytest.fixture()
def env(tmp_path, monkeypatch):
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


def _wait_done(client: TestClient, job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/ingest/{job_id}").json()
        if body.get("status") in ("done", "error", "timeout"):
            return body
        time.sleep(0.05)
    return body


class TestAnchorPrecisionDerivation:
    def test_docling_parses_are_region_precision(self):
        assert _anchor_precision_for("docling", "2.131.0") == "region"

    def test_vlm_parses_are_page_precision_and_never_upgraded(self):
        assert _anchor_precision_for("vlm", "qwen3.8-27b") == "page"

    def test_unknown_engines_are_refused_not_guessed(self):
        with pytest.raises(ValueError):
            _anchor_precision_for("mystery", "1.0")


class TestParseArtifacts:
    def test_a_parse_lands_with_parser_identity_and_precision(self, env):
        with TestClient(app) as client:
            submit = _upload(client, "first.pdf")
            done = _wait_done(client, submit["jobId"])
            assert done["status"] == "done"
            paper_id = submit["repo"]["paper_id"]
            parses = client.get(f"/api/papers/{paper_id}/parses").json()["parses"]
        assert len(parses) == 1
        parse = parses[0]
        assert parse["parser"] == "docling"
        assert parse["parser_version"]  # non-empty
        assert parse["anchor_precision"] == "region"

    def test_reparse_adds_a_new_artifact_and_the_old_stays_openable(self, env):
        with TestClient(app) as client:
            first = _upload(client, "one.pdf")
            _wait_done(client, first["jobId"])
            paper_id = first["repo"]["paper_id"]
            listing1 = client.get(f"/api/papers/{paper_id}/parses").json()["parses"]
            assert len(listing1) == 1
            old_parse_id = listing1[0]["parse_id"]

            # re-parse: same bytes upload again → same paper, NEW parse artifact
            second = _upload(client, "again.pdf")
            _wait_done(client, second["jobId"])
            listing2 = client.get(f"/api/papers/{paper_id}/parses").json()["parses"]
            assert len(listing2) == 2  # append-only, both present

            # the OLD artifact still opens with its original content
            old = client.get(f"/api/papers/{paper_id}/parses/{old_parse_id}")
            assert old.status_code == 200
            assert old.json()["docId"]  # full parse JSON served

    def test_old_precision_is_never_upgraded_on_reparse(self, env):
        # seed a page-precision artifact (as a VLM parse would produce), then
        # re-parse via docling — the old row keeps 'page', the new gets 'region'
        conn = db.connect(TEST_DB_URL)
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM paper_versions LIMIT 1")
        # ensure a paper exists first through the real consumer
        conn.close()
        with TestClient(app) as client:
            first = _upload(client, "seed.pdf")
            _wait_done(client, first["jobId"])
            paper_id = first["repo"]["paper_id"]
        conn = db.connect(TEST_DB_URL)
        # mutate the stored row to page precision (simulating a prior VLM parse)
        with conn.cursor() as cur:
            cur.execute("UPDATE parse_artifacts SET anchor_precision = 'page', parser = 'vlm' WHERE paper_id = %(p)s", {"p": paper_id})
        conn.commit()
        conn.close()
        with TestClient(app) as client:
            again = _upload(client, "reparse.pdf")
            _wait_done(client, again["jobId"])
            parses = client.get(f"/api/papers/{paper_id}/parses").json()["parses"]
        precisions = {p["anchor_precision"] for p in parses}
        assert precisions == {"page", "region"}  # old kept, new derived — no upgrade

    def test_unknown_parse_id_is_404(self, env):
        with TestClient(app) as client:
            first = _upload(client, "x.pdf")
            _wait_done(client, first["jobId"])
            paper_id = first["repo"]["paper_id"]
            res = client.get(f"/api/papers/{paper_id}/parses/999999")
        assert res.status_code == 404
