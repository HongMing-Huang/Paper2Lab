"""Parse-result persistence shared by the API's in-process parse path and the
J1.1 queue worker — ONE code path for "document + append-only parse
artifact", so the worker can never drift from what the API writes.

Kept dependency-light at import time (no FastAPI app, no docling): the queue
worker imports it without dragging the API module (whose import restores jobs
and builds the app) into its process.
"""
from __future__ import annotations

from typing import Any


def anchor_precision_for(engine: str, version: str) -> str:
    """P1.2: anchor precision stamped at parse time. docling yields region
    (bbox) anchors; the VLM fast path yields page-level anchors only. An
    unknown engine is REFUSED — never guessed (a wrong precision silently
    breaks anchor openability)."""
    if engine == "docling":
        return "region"
    if engine == "vlm":
        return "page"
    raise ValueError(f"unknown parse engine: {engine!r} (version {version!r}) — refusing to guess anchor precision")


def persist_parse_result(
    conn: Any,
    result: dict[str, Any],
    *,
    paper_id: str | None,
    version_id: str | None,
    mode: str,
    commit: bool = True,
) -> None:
    """D1.3 write authority: the documents table only (no JSON dual write);
    P1.2: plus one APPEND-ONLY parse artifact (parser identity + anchor
    precision) when the upload has a Paper identity. Both writes are ONE
    transaction — a failed artifact write can never leave an orphan document
    (review finding). commit=False hands the open transaction to the caller
    (the J1.1 worker also settles its task in it). Raises on failure — the
    caller records it, never swallows it."""
    from server import db

    db.store_document(conn, result, commit=False)
    if paper_id:
        parser = mode if mode in ("docling", "vlm") else str(result.get("engine") or mode)
        parser_version = str(result.get("doclingVersion") or result.get("vlmModel") or "unknown")
        db.store_parse_artifact(
            conn,
            paper_id=paper_id,
            version_id=version_id,
            doc_id=str(result.get("docId") or ""),
            parser=parser,
            parser_version=parser_version,
            anchor_precision=anchor_precision_for(parser, parser_version),
            parse_payload=result,
            commit=False,
        )
    if commit:
        conn.commit()
