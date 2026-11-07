"""D1.3 — repository export/restore drill.

export_repo snapshots every domain table to a JSON dump (rows + per-table
counts); restore_repo rebuilds those tables from the dump into a freshly
truncated schema and returns the same counts structure, so a wipe-and-restore
round-trip is verifiable by equality. The legacy JSONL files are NOT written
by this module — the dump is the recovery artifact for the drill.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row


def _plain(row: dict[str, Any]) -> dict[str, Any]:
    """JSON-safe copy of one row (dates → iso strings, dict/list kept)"""
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in row.items()}


def export_repo(conn: psycopg.Connection, out_path: Path) -> dict[str, int]:
    """snapshot the domain tables; returns per-table row counts"""
    tables: dict[str, list[dict[str, Any]]] = {}
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT id, created_at FROM workspaces")
        tables["workspaces"] = [_plain(r) for r in cur.fetchall()]
        cur.execute("SELECT sha256, byte_length, created_at FROM artifacts")
        tables["artifacts"] = [_plain(r) for r in cur.fetchall()]
        cur.execute("SELECT id, workspace_id, sha256, title_hint, created_at FROM papers")
        tables["papers"] = [_plain(r) for r in cur.fetchall()]
        cur.execute("SELECT id, paper_id, artifact_sha, size_bytes, created_at FROM paper_versions")
        tables["paper_versions"] = [_plain(r) for r in cur.fetchall()]
        cur.execute("SELECT version_id, filename, uploaded_at FROM upload_events")
        tables["upload_events"] = [_plain(r) for r in cur.fetchall()]
        cur.execute("SELECT doc_id, workspace_id, provenance, content_sha256, doc_json, created_at FROM documents")
        tables["documents"] = [_plain(r) for r in cur.fetchall()]
    out_path.write_text(json.dumps(dump := {"tables": tables}, ensure_ascii=False, default=str))
    return {name: len(rows) for name, rows in tables.items()}


def restore_repo(conn: psycopg.Connection, in_path: Path) -> dict[str, int]:
    """rebuild the domain tables from a dump (tables must be empty — FK-safe
    parent-first order); returns per-table counts for equality vs the export"""
    tables = json.loads(in_path.read_text())["tables"]
    with conn.cursor() as cur:
        for row in tables.get("workspaces", []):
            cur.execute("INSERT INTO workspaces (id, created_at) VALUES (%(id)s, %(created_at)s)", row)
        for row in tables.get("artifacts", []):
            cur.execute("INSERT INTO artifacts (sha256, byte_length, created_at) VALUES (%(sha256)s, %(byte_length)s, %(created_at)s)", row)
        for row in tables.get("papers", []):
            cur.execute("INSERT INTO papers (id, workspace_id, sha256, title_hint, created_at) VALUES (%(id)s, %(workspace_id)s, %(sha256)s, %(title_hint)s, %(created_at)s)", row)
        for row in tables.get("paper_versions", []):
            cur.execute("INSERT INTO paper_versions (id, paper_id, artifact_sha, size_bytes, created_at) VALUES (%(id)s, %(paper_id)s, %(artifact_sha)s, %(size_bytes)s, %(created_at)s)", row)
        for row in tables.get("upload_events", []):
            cur.execute("INSERT INTO upload_events (version_id, filename, uploaded_at) VALUES (%(version_id)s, %(filename)s, %(uploaded_at)s)", row)
        for row in tables.get("documents", []):
            # doc_json round-trips through JSON as a dict — serialize back for the JSONB cast
            doc_row = {**row, "doc_json": json.dumps(row["doc_json"], ensure_ascii=False)}
            cur.execute("INSERT INTO documents (doc_id, workspace_id, provenance, content_sha256, doc_json, created_at) VALUES (%(doc_id)s, %(workspace_id)s, %(provenance)s, %(content_sha256)s, %(doc_json)s::jsonb, %(created_at)s)", doc_row)
    conn.commit()
    return {name: len(rows) for name, rows in tables.items()}
