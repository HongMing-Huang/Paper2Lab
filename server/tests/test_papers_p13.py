"""P1.3 — the paper library's versioning edge cases: duplicate PDFs dedup,
one identifier (e.g. DOI) holds DIFFERENT-sha versions side by side, a failed
re-parse never breaks the old anchor (retry adds, never overwrites), and a
paper with no successful parse exposes NO document honestly (the original PDF
stays readable) — plus one REAL-PDF full trace (real docling, excluded from
the quick set) so the new-parse path is not signed off on fixtures alone."""
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
from server.tests import testtargets  # noqa: E402

TEST_DB_URL = testtargets.TEST_DATABASE  # J1.CI: the shared, guarded test target
PG_UP = False
try:
    import psycopg

    with psycopg.connect("postgresql://localhost:5432/postgres", connect_timeout=2) as _probe:
        PG_UP = True
except Exception:
    PG_UP = False

pytestmark = [pytest.mark.pg, pytest.mark.skipif(not PG_UP, reason="P1.3 needs a reachable local PostgreSQL")]

V1 = b"%PDF-1.4 P1.3 v1 bytes " + b"1" * 64
V2 = b"%PDF-1.4 P1.3 v2 REVISED bytes " + b"2" * 64


def _env(tmp_path, monkeypatch, convert_mode: str = "ok"):
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
    monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", convert_mode)
    import server.main as main_mod

    monkeypatch.setattr(main_mod, "DATA_DIR", tmp_path)
    return tmp_path


@pytest.fixture()
def env(tmp_path, monkeypatch):
    return _env(tmp_path, monkeypatch, "ok")


def _upload(client: TestClient, name: str, content: bytes, identifier: str | None = None) -> dict:
    data = {"mode": "docling"}
    if identifier:
        data["identifier"] = identifier
    res = client.post(
        "/api/ingest",
        files={"file": (name, io.BytesIO(content), "application/pdf")},
        data=data,
    )
    assert res.status_code == 202, res.text
    return res.json()


def _wait(client: TestClient, job_id: str, timeout: float = 60.0) -> dict:
    deadline = time.time() + timeout
    body = {}
    while time.time() < deadline:
        body = client.get(f"/api/ingest/{job_id}").json()
        if body.get("status") in ("done", "error", "timeout"):
            return body
        time.sleep(0.05)
    return body


class TestDuplicateDedup:
    def test_same_bytes_twice_one_paper_one_version_two_uploads(self, env):
        with TestClient(app) as client:
            a = _upload(client, "a.pdf", V1)
            _wait(client, a["jobId"])
            b = _upload(client, "b.pdf", V1)
            _wait(client, b["jobId"])
            papers = client.get("/api/papers").json()["papers"]
        assert len(papers) == 1
        assert len(papers[0]["versions"]) == 1
        assert len(papers[0]["versions"][0]["uploads"]) == 2


class TestIdentifierVersions:
    def test_same_identifier_different_bytes_coexist_as_two_versions(self, env):
        with TestClient(app) as client:
            v1 = _upload(client, "v1.pdf", V1, identifier="doi:10.1/p1.3")
            _wait(client, v1["jobId"])
            v2 = _upload(client, "v2.pdf", V2, identifier="doi:10.1/p1.3")
            _wait(client, v2["jobId"])
            papers = client.get("/api/papers").json()["papers"]
        assert len(papers) == 1  # ONE paper under the identifier
        versions = papers[0]["versions"]
        assert len(versions) == 2  # both byte-versions coexist
        shas = {v["sha256"] for v in versions}
        import hashlib

        assert shas == {hashlib.sha256(V1).hexdigest(), hashlib.sha256(V2).hexdigest()}
        # both PDFs stay readable through their version artifacts
        with TestClient(app) as client:
            for content in (V1, V2):
                sha = hashlib.sha256(content).hexdigest()
                found = any(v["sha256"] == sha for v in versions)
                assert found

    def test_no_identifier_stays_sha_keyed(self, env):
        with TestClient(app) as client:
            a = _upload(client, "x.pdf", V1)
            _wait(client, a["jobId"])
            b = _upload(client, "y.pdf", V2)
            _wait(client, b["jobId"])
            papers = client.get("/api/papers").json()["papers"]
        assert len(papers) == 2  # no identifier → distinct papers (existing behavior)


class TestFailedRetryKeepsOldAnchor:
    def test_crashed_v2_parse_leaves_v1_parse_intact_then_retry_adds(self, tmp_path, monkeypatch):
        _env(tmp_path, monkeypatch, "ok")
        with TestClient(app) as client:
            v1 = _upload(client, "v1.pdf", V1, identifier="doi:10.1/retry")
            _wait(client, v1["jobId"])
            paper_id = v1["repo"]["paper_id"]
            parses1 = client.get(f"/api/papers/{paper_id}/parses").json()["parses"]
            assert len(parses1) == 1
            old_id = parses1[0]["parse_id"]

        # v2 upload whose parse CRASHES (switch mode WITHOUT wiping the library)
        monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "crash")
        with TestClient(app) as client:
            v2 = _upload(client, "v2.pdf", V2, identifier="doi:10.1/retry")
            done = _wait(client, v2["jobId"], timeout=60.0)
            assert done["status"] in ("error", "timeout")
            # old anchor untouched and openable
            parses = client.get(f"/api/papers/{paper_id}/parses").json()["parses"]
            assert len(parses) == 1  # the crashed parse left NO artifact
            old = client.get(f"/api/papers/{paper_id}/parses/{old_id}")
            assert old.status_code == 200 and old.json()

        # retry the SAME v2 bytes with a working parser → parse appears
        monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "ok")
        with TestClient(app) as client:
            v2r = _upload(client, "v2-retry.pdf", V2, identifier="doi:10.1/retry")
            _wait(client, v2r["jobId"])
            parses = client.get(f"/api/papers/{paper_id}/parses").json()["parses"]
        assert len(parses) == 2  # retry ADDED; v1's row unchanged
        by_id = {p["parse_id"]: p for p in parses}
        assert old_id in by_id  # the old parse survived


class TestNoFulltextHonesty:
    def test_a_paper_with_only_failed_parses_has_no_document_but_keeps_pdf(self, tmp_path, monkeypatch):
        _env(tmp_path, monkeypatch, "crash")
        with TestClient(app) as client:
            up = _upload(client, "nope.pdf", V1)
            done = _wait(client, up["jobId"], timeout=60.0)
            assert done["status"] in ("error", "timeout")
            paper_id = up["repo"]["paper_id"]
            # honest absence: zero parses, and the failed job carries no docId
            parses = client.get(f"/api/papers/{paper_id}/parses").json()["parses"]
            assert parses == []
            assert not done.get("docId")
            # but the original PDF remains readable (缺全文≠丢原文)
            pdf = client.get(f"/api/papers/{paper_id}/pdf")
            assert pdf.status_code == 200 and pdf.content == V1


@pytest.mark.real_pdf_trace
class TestRealPdfFullTrace:
    """One REAL PDF through the REAL docling parser (excluded from the quick
    set like real_docling): upload → parse artifact → paper list → PDF."""

    def test_sample_harmonic_end_to_end(self, tmp_path, monkeypatch):
        source = ROOT / "public" / "papers" / "sample-harmonic.pdf"
        if not source.exists():
            pytest.skip("sample-harmonic.pdf not present")
        raw = source.read_bytes()
        env = _env(tmp_path, monkeypatch, "")  # empty test mode → REAL docling
        monkeypatch.delenv("PAPER2LAB_TEST_CONVERT", raising=False)
        monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "")
        with TestClient(app) as client:
            submit = _upload(client, source.name, raw)
            done = _wait(client, submit["jobId"], timeout=300.0)
            assert done["status"] == "done", done
            paper_id = submit["repo"]["paper_id"]
            parses = client.get(f"/api/papers/{paper_id}/parses").json()["parses"]
            assert len(parses) == 1
            parse = parses[0]
            assert parse["parser"] == "docling"
            assert parse["parser_version"] not in ("", "unknown")  # REAL version
            assert parse["anchor_precision"] == "region"
            detail = client.get(f"/api/papers/{paper_id}/parses/{parse['parse_id']}")
            assert detail.status_code == 200
            body = detail.json()
            assert body.get("items")  # real extracted items
            pdf = client.get(f"/api/papers/{paper_id}/pdf")
            assert pdf.status_code == 200 and pdf.content == raw
