"""D1.1 — the minimal PostgreSQL repository layer.

Content-addressed artifacts (sha256 blob store on disk), workspace-scoped
Paper/Version identity with same-file dedup, and an append-only upload_events
provenance row per upload. The JSON/JSONL path in main.py stays the write
authority until D1.3 switches it — this module only ADDS the real database
round-trip for the upload consumer.

Every execute site carries its statement as a single string LITERAL with all
values bound through NAMED parameters — no interpolation, no concatenation,
no variable-first-argument executes.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row


def connect(url: str | None = None) -> psycopg.Connection:
    """a dict-row connection to the repository (caller owns the lifecycle)"""
    target = url or os.environ.get("PAPER2LAB_DATABASE_URL")
    if not target:
        raise RuntimeError("PAPER2LAB_DATABASE_URL is not configured — the repository is opt-in until D1.3")
    return psycopg.connect(target, row_factory=dict_row, autocommit=False)


def _record_migration(cur: Any, version: int, ddl: str, rollback_note: str) -> None:
    """stamp an applied migration (ddl/rollback are the static literals above)"""
    cur.execute("INSERT INTO schema_migrations (version, statement, rollback_note) VALUES (%(v)s, %(s)s, %(r)s)", {"v": version, "s": ddl, "r": rollback_note})


def migrate(conn: psycopg.Connection) -> None:
    """apply pending additive migrations; replay-safe (versioned, IF NOT EXISTS)"""
    with conn.cursor() as cur:
        cur.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), statement TEXT NOT NULL, rollback_note TEXT NOT NULL)")
        cur.execute("SELECT max(version) FROM schema_migrations")
        row = cur.fetchone()
        current = row["max"] or 0
        if current < 1:
            ddl = "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            cur.execute("CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            _record_migration(cur, 1, ddl, "DROP TABLE workspaces")
        if current < 2:
            ddl = "CREATE TABLE IF NOT EXISTS artifacts (sha256 TEXT PRIMARY KEY, byte_length BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            cur.execute("CREATE TABLE IF NOT EXISTS artifacts (sha256 TEXT PRIMARY KEY, byte_length BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            _record_migration(cur, 2, ddl, "DROP TABLE artifacts")
        if current < 3:
            ddl = "CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces (id), sha256 TEXT NOT NULL, title_hint TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (workspace_id, sha256))"
            cur.execute("CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces (id), sha256 TEXT NOT NULL, title_hint TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (workspace_id, sha256))")
            _record_migration(cur, 3, ddl, "DROP TABLE papers")
        if current < 4:
            ddl = "CREATE TABLE IF NOT EXISTS paper_versions (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers (id), artifact_sha TEXT NOT NULL REFERENCES artifacts (sha256), size_bytes BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (paper_id, artifact_sha))"
            cur.execute("CREATE TABLE IF NOT EXISTS paper_versions (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers (id), artifact_sha TEXT NOT NULL REFERENCES artifacts (sha256), size_bytes BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (paper_id, artifact_sha))")
            _record_migration(cur, 4, ddl, "DROP TABLE paper_versions")
        if current < 5:
            ddl = "CREATE TABLE IF NOT EXISTS upload_events (id BIGSERIAL PRIMARY KEY, version_id TEXT NOT NULL REFERENCES paper_versions (id), filename TEXT NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            cur.execute("CREATE TABLE IF NOT EXISTS upload_events (id BIGSERIAL PRIMARY KEY, version_id TEXT NOT NULL REFERENCES paper_versions (id), filename TEXT NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            _record_migration(cur, 5, ddl, "DROP TABLE upload_events")
        if current < 6:
            # D1.2: read-only landing tables for the legacy JSON/JSONL snapshots
            ddl = "CREATE TABLE IF NOT EXISTS imported_docs (doc_id TEXT PRIMARY KEY, provenance TEXT NOT NULL, content_sha256 TEXT NOT NULL, doc_json JSONB NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            cur.execute("CREATE TABLE IF NOT EXISTS imported_docs (doc_id TEXT PRIMARY KEY, provenance TEXT NOT NULL, content_sha256 TEXT NOT NULL, doc_json JSONB NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            _record_migration(cur, 6, ddl, "DROP TABLE imported_docs")
        if current < 7:
            ddl = "CREATE TABLE IF NOT EXISTS imported_runs (run_id TEXT PRIMARY KEY, status TEXT NOT NULL, result_json JSONB, record_json JSONB NOT NULL, content_sha256 TEXT NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            cur.execute("CREATE TABLE IF NOT EXISTS imported_runs (run_id TEXT PRIMARY KEY, status TEXT NOT NULL, result_json JSONB, record_json JSONB NOT NULL, content_sha256 TEXT NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            _record_migration(cur, 7, ddl, "DROP TABLE imported_runs")
        if current < 8:
            # D1.3: the WRITE-AUTHORITY table for parse results — the upload
            # consumer persists here only (no dual write to doc-*.json)
            ddl = "CREATE TABLE IF NOT EXISTS documents (doc_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL DEFAULT 'default', provenance TEXT NOT NULL, content_sha256 TEXT NOT NULL, doc_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            cur.execute("CREATE TABLE IF NOT EXISTS documents (doc_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL DEFAULT 'default', provenance TEXT NOT NULL, content_sha256 TEXT NOT NULL, doc_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            _record_migration(cur, 8, ddl, "DROP TABLE documents")
        if current < 9:
            # P1.2: append-only PARSE ARTIFACTS — every parse is a new row with
            # parser identity + anchor precision; old rows are never upgraded
            ddl = "CREATE TABLE IF NOT EXISTS parse_artifacts (id BIGSERIAL PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers (id), version_id TEXT NOT NULL REFERENCES paper_versions (id), doc_id TEXT NOT NULL, parser TEXT NOT NULL, parser_version TEXT NOT NULL, anchor_precision TEXT NOT NULL, parse_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            cur.execute("CREATE TABLE IF NOT EXISTS parse_artifacts (id BIGSERIAL PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers (id), version_id TEXT NOT NULL REFERENCES paper_versions (id), doc_id TEXT NOT NULL, parser TEXT NOT NULL, parser_version TEXT NOT NULL, anchor_precision TEXT NOT NULL, parse_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            _record_migration(cur, 9, ddl, "DROP TABLE parse_artifacts")
        if current < 10:
            # P1.3: optional external identifier (e.g. DOI) — papers sharing an
            # identifier hold DIFFERENT-sha versions side by side; a partial
            # unique index keeps one paper per (workspace, identifier)
            ddl = "ALTER TABLE papers ADD COLUMN IF NOT EXISTS identifier TEXT"
            cur.execute("ALTER TABLE papers ADD COLUMN IF NOT EXISTS identifier TEXT")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS papers_ws_identifier_uq ON papers (workspace_id, identifier) WHERE identifier IS NOT NULL")
            _record_migration(cur, 10, ddl + "; CREATE UNIQUE INDEX papers_ws_identifier_uq", "DROP INDEX papers_ws_identifier_uq; ALTER TABLE papers DROP COLUMN identifier")
        if current < 11:
            # J1.1: the persistent task ledger — one research task per parse,
            # append-only attempt rows for every lifecycle transition, and an
            # outbox of domain events for consumers to follow
            ddl = "CREATE TABLE IF NOT EXISTS research_tasks (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'queued', rq_job_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ)"
            cur.execute("CREATE TABLE IF NOT EXISTS research_tasks (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'queued', rq_job_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ)")
            _record_migration(cur, 11, ddl, "DROP TABLE research_tasks")
        if current < 12:
            ddl = "CREATE TABLE IF NOT EXISTS job_attempts (id BIGSERIAL PRIMARY KEY, task_id BIGINT NOT NULL REFERENCES research_tasks (id), status TEXT NOT NULL, detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            cur.execute("CREATE TABLE IF NOT EXISTS job_attempts (id BIGSERIAL PRIMARY KEY, task_id BIGINT NOT NULL REFERENCES research_tasks (id), status TEXT NOT NULL, detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            _record_migration(cur, 12, ddl, "DROP TABLE job_attempts")
        if current < 13:
            ddl = "CREATE TABLE IF NOT EXISTS outbox_events (id BIGSERIAL PRIMARY KEY, task_id BIGINT NOT NULL REFERENCES research_tasks (id), event_type TEXT NOT NULL, body JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            cur.execute("CREATE TABLE IF NOT EXISTS outbox_events (id BIGSERIAL PRIMARY KEY, task_id BIGINT NOT NULL REFERENCES research_tasks (id), event_type TEXT NOT NULL, body JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            _record_migration(cur, 13, ddl, "DROP TABLE outbox_events")
        if current < 14:
            # J1.1: the queue worker stamps the progress stage, the claim time
            # and a structured result (docId | failure kind + killed pid)
            ddl = "ALTER TABLE research_tasks ADD COLUMN IF NOT EXISTS stage TEXT, ADD COLUMN IF NOT EXISTS result JSONB, ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ"
            cur.execute("ALTER TABLE research_tasks ADD COLUMN IF NOT EXISTS stage TEXT, ADD COLUMN IF NOT EXISTS result JSONB, ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ")
            _record_migration(cur, 14, ddl, "ALTER TABLE research_tasks DROP COLUMN stage, DROP COLUMN result, DROP COLUMN started_at")
    conn.commit()


def ensure_workspace(conn: psycopg.Connection, workspace: str) -> dict[str, Any]:
    """idempotent workspace identity (single-user deployments use 'default')"""
    with conn.cursor() as cur:
        cur.execute("INSERT INTO workspaces (id) VALUES (%(w)s) ON CONFLICT (id) DO NOTHING", {"w": workspace})
        cur.execute("SELECT * FROM workspaces WHERE id = %(w)s", {"w": workspace})
        row = cur.fetchone()
    conn.commit()
    return row


def _blob_path(storage_root: Path, sha256: str) -> Path:
    return storage_root / "artifacts" / sha256[:2] / sha256


def store_paper_upload(
    conn: psycopg.Connection,
    *,
    workspace: str,
    filename: str,
    content: bytes,
    storage_root: Path,
    identifier: str | None = None,
) -> dict[str, Any]:
    """the real round-trip: content-addressed blob + workspace-scoped identity.

    Same bytes in one workspace → the SAME paper and version (dedup), with an
    append-only upload_events row per upload preserving per-source provenance
    (P1 builds per-source anchors on top). The blob store is global: identical
    bytes across workspaces share one artifact.

    P1.3: an optional external identifier (e.g. DOI) keys the PAPER — uploads
    with the same identifier but DIFFERENT bytes become coexisting VERSIONS of
    one paper instead of separate papers."""
    ensure_workspace(conn, workspace)
    sha = hashlib.sha256(content).hexdigest()
    blob = _blob_path(storage_root, sha)
    blob.parent.mkdir(parents=True, exist_ok=True)
    if not blob.exists():  # content-addressed: same sha ⇒ same bytes, never rewritten
        # unique temp name per writer: two processes storing the same content
        # concurrently must not fight over one .part (one would lose its write)
        import uuid as _uuid

        tmp = blob.with_suffix(f".{_uuid.uuid4().hex[:8]}.part")
        tmp.write_bytes(content)
        tmp.replace(blob)

    title_hint = str(filename).rsplit(".", 1)[0]
    size = len(content)
    with conn.cursor() as cur:
        paper = None
        if identifier:
            # P1.3: the identifier keys the paper — same identifier, new bytes
            # → a NEW version row under the SAME paper
            cur.execute("SELECT * FROM papers WHERE workspace_id = %(ws)s AND identifier = %(i)s", {"ws": workspace, "i": identifier})
            paper = cur.fetchone()
            # review #2c: a bare sha-paper already exists for these bytes —
            # backfill the identifier onto it instead of silently dropping it
            if paper is None:
                cur.execute("SELECT * FROM papers WHERE workspace_id = %(ws)s AND sha256 = %(sh)s", {"ws": workspace, "sh": sha})
                existing = cur.fetchone()
                if existing is not None and existing["identifier"] is None:
                    cur.execute("UPDATE papers SET identifier = %(i)s WHERE id = %(d)s", {"i": identifier, "d": existing["id"]})
                    paper = existing
        if paper is None:
            # sha-keyed identity (the default): one paper per (workspace, content)
            scope = hashlib.sha256((workspace + ":" + sha).encode()).hexdigest()
            paper_id = "paper-" + scope[:12]
            cur.execute(
                "INSERT INTO papers (id, workspace_id, sha256, title_hint, identifier) VALUES (%(i)s, %(ws)s, %(sh)s, %(t)s, %(id)s) ON CONFLICT (workspace_id, sha256) DO NOTHING",
                {"i": paper_id, "ws": workspace, "sh": sha, "t": title_hint, "id": identifier},
            )
            cur.execute("SELECT * FROM papers WHERE workspace_id = %(ws)s AND sha256 = %(sh)s", {"ws": workspace, "sh": sha})
            paper = cur.fetchone()
        # version id derived from (paper, sha) — collision-free across paths
        version_id = "pv-" + hashlib.sha256((paper["id"] + ":" + sha).encode()).hexdigest()[:16]
        cur.execute("INSERT INTO artifacts (sha256, byte_length) VALUES (%(sh)s, %(n)s) ON CONFLICT (sha256) DO NOTHING", {"sh": sha, "n": size})
        cur.execute("INSERT INTO paper_versions (id, paper_id, artifact_sha, size_bytes) VALUES (%(i)s, %(p)s, %(sh)s, %(n)s) ON CONFLICT (paper_id, artifact_sha) DO NOTHING", {"i": version_id, "p": paper["id"], "sh": sha, "n": size})
        cur.execute("SELECT * FROM paper_versions WHERE paper_id = %(p)s AND artifact_sha = %(sh)s", {"p": paper["id"], "sh": sha})
        version = cur.fetchone()
        cur.execute("INSERT INTO upload_events (version_id, filename) VALUES (%(v)s, %(f)s)", {"v": version["id"], "f": str(filename)})
    conn.commit()
    return {
        "sha256": sha,
        "paper_id": paper["id"],
        "version_id": version["id"],
        "artifact_sha256": version["artifact_sha"],
        "size_bytes": version["size_bytes"],
        "stored_at": time.time(),
    }


def get_paper_by_sha(conn: psycopg.Connection, *, workspace: str, sha256: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM papers WHERE workspace_id = %(ws)s AND sha256 = %(sh)s", {"ws": workspace, "sh": sha256})
        return cur.fetchone()


def artifact_bytes(sha256: str, *, storage_root: Path) -> bytes | None:
    """read a stored artifact back (None when absent) — the blob is the truth"""
    blob = _blob_path(storage_root, sha256)
    return blob.read_bytes() if blob.exists() else None


def store_document(conn: psycopg.Connection, doc_payload: dict[str, Any], *, commit: bool = True) -> dict[str, Any]:
    """D1.3 WRITE AUTHORITY for parse results: persist the document to the
    documents table ONLY. Re-parsing the same docId updates the row (latest
    content wins, sha stamped per write — P1 versions parses properly).
    commit=False leaves the write in the caller's transaction (J1.1: the
    worker commits document + parse artifact + task settlement atomically)."""
    doc_id = str(doc_payload.get("docId") or "")
    if not doc_id:
        raise ValueError("document payload carries no docId")
    raw = json.dumps(doc_payload, ensure_ascii=False)
    sha = "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO documents (doc_id, workspace_id, provenance, content_sha256, doc_json) VALUES (%(d)s, 'default', 'pg-authority', %(s)s, %(j)s::jsonb) ON CONFLICT (doc_id) DO UPDATE SET content_sha256 = %(s)s, doc_json = %(j)s::jsonb",
            {"d": doc_id, "s": sha, "j": raw},
        )
    if commit:
        conn.commit()
    return {"doc_id": doc_id, "content_sha256": sha}


def get_document(conn: psycopg.Connection, doc_id: str) -> dict[str, Any] | None:
    """read a document from the write-authority table (None when absent)"""
    with conn.cursor() as cur:
        cur.execute("SELECT doc_json FROM documents WHERE doc_id = %(d)s", {"d": doc_id})
        row = cur.fetchone()
    return row["doc_json"] if row else None


def list_papers(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """P1.1: the versioned paper library listing — papers with their versions
    and per-upload provenance (upload_events), newest uploads first"""
    _list_sql = "SELECT p.id, p.title_hint, v.id AS version_id, v.size_bytes, a.sha256, e.filename, e.uploaded_at FROM papers p JOIN paper_versions v ON v.paper_id = p.id JOIN artifacts a ON a.sha256 = v.artifact_sha LEFT JOIN upload_events e ON e.version_id = v.id ORDER BY p.created_at, v.created_at, e.uploaded_at DESC"
    with conn.cursor() as cur:
        cur.execute(_list_sql)
        rows = cur.fetchall()
    papers: dict[str, dict[str, Any]] = {}
    for r in rows:
        paper = papers.setdefault(r["id"], {"paper_id": r["id"], "title_hint": r["title_hint"], "versions": []})
        version = next((v for v in paper["versions"] if v["version_id"] == r["version_id"]), None)
        if version is None:
            version = {"version_id": r["version_id"], "sha256": r["sha256"], "size_bytes": r["size_bytes"], "uploads": []}
            paper["versions"].append(version)
        if r["filename"] is not None:
            version["uploads"].append({"filename": r["filename"], "uploaded_at": r["uploaded_at"]})
    return list(papers.values())


def paper_artifact_sha(conn: psycopg.Connection, paper_id: str) -> str | None:
    """P1.1: the (latest) stored artifact sha for a paper — the original PDF"""
    _latest_sql = "SELECT artifact_sha FROM paper_versions WHERE paper_id = %(p)s ORDER BY created_at DESC LIMIT 1"
    with conn.cursor() as cur:
        cur.execute(_latest_sql, {"p": paper_id})
        row = cur.fetchone()
    return row["artifact_sha"] if row else None


def store_parse_artifact(
    conn: psycopg.Connection,
    *,
    paper_id: str,
    version_id: str,
    doc_id: str,
    parser: str,
    parser_version: str,
    anchor_precision: str,
    parse_payload: dict[str, Any],
    commit: bool = True,
) -> int:
    """P1.2: append ONE parse artifact row — re-parses add rows, they never
    overwrite; anchor precision is stamped at write time and never upgraded.
    commit=False leaves the write in the caller's transaction."""
    raw = json.dumps(parse_payload, ensure_ascii=False)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO parse_artifacts (paper_id, version_id, doc_id, parser, parser_version, anchor_precision, parse_json) VALUES (%(p)s, %(v)s, %(d)s, %(pa)s, %(pv)s, %(ap)s, %(j)s::jsonb) RETURNING id",
            {"p": paper_id, "v": version_id, "d": doc_id, "pa": parser, "pv": parser_version, "ap": anchor_precision, "j": raw},
        )
        row = cur.fetchone()
    if commit:
        conn.commit()
    return row["id"]


def list_parse_artifacts(conn: psycopg.Connection, paper_id: str) -> list[dict[str, Any]]:
    """P1.2: parse listing (no bodies) — newest first"""
    _list_sql = "SELECT id, parser, parser_version, anchor_precision, created_at FROM parse_artifacts WHERE paper_id = %(p)s ORDER BY id DESC"
    with conn.cursor() as cur:
        cur.execute(_list_sql, {"p": paper_id})
        rows = cur.fetchall()
    return [
        {"parse_id": r["id"], "parser": r["parser"], "parser_version": r["parser_version"], "anchor_precision": r["anchor_precision"], "created_at": r["created_at"]}
        for r in rows
    ]


def get_parse_artifact(conn: psycopg.Connection, paper_id: str, parse_id: int) -> dict[str, Any] | None:
    """P1.2: the FULL parse JSON of one artifact (old anchors stay openable)"""
    _get_sql = "SELECT parse_json FROM parse_artifacts WHERE id = %(i)s AND paper_id = %(p)s"
    with conn.cursor() as cur:
        cur.execute(_get_sql, {"i": parse_id, "p": paper_id})
        row = cur.fetchone()
    return row["parse_json"] if row else None
