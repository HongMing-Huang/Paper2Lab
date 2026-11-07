"""D1.2 — read-only import of the legacy JSON/JSONL snapshots.

doc-doc-*.json parse results and the engine-runs.jsonl Run log land in
imported_docs / imported_runs with their ORIGINAL ids, provenance stamped
'legacy-json' / 'legacy-jsonl' (never silently upgraded), content hashes for
independent verification, and idempotent semantics: a repeat import skips
known ids, reports a changed file under a known id as a CONFLICT instead of
overwriting, and never produces a new Run (no recompute — the legacy numbers
are stored byte-identical as JSON). The old files stay the write authority
until D1.3; this import is a one-way read.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import psycopg


@dataclass
class ImportReport:
    imported: int = 0
    skipped: int = 0
    conflicts: int = 0
    errors: int = 0
    sources: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "imported": self.imported,
            "skipped": self.skipped,
            "conflicts": self.conflicts,
            "errors": self.errors,
            "sources": self.sources,
        }


_DOC_NAME = re.compile(r"^doc-(?P<doc_id>.+)\.json$")


def _sha256(raw: bytes) -> str:
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def import_doc_snapshots(conn: psycopg.Connection, directory: Path) -> ImportReport:
    """read-only import of doc-*.json snapshots; original ids preserved"""
    report = ImportReport()
    for path in sorted(directory.glob("doc-*.json")):
        m = _DOC_NAME.match(path.name)
        if not m:
            continue
        doc_id = m.group("doc_id")
        raw = path.read_bytes()
        sha = _sha256(raw)
        try:
            doc = json.loads(raw)
        except ValueError:
            report.errors += 1
            report.sources.append({"file": path.name, "error": "invalid JSON"})
            continue
        if not isinstance(doc, dict) or doc.get("docId") != doc_id:
            report.errors += 1
            report.sources.append({"file": path.name, "error": "docId mismatch with filename"})
            continue
        with conn.cursor() as cur:
            cur.execute("SELECT content_sha256 FROM imported_docs WHERE doc_id = %(d)s", {"d": doc_id})
            existing = cur.fetchone()
            if existing is not None:
                if existing["content_sha256"] != sha:
                    report.conflicts += 1  # known id, CHANGED content — never overwritten
                    report.sources.append({"file": path.name, "conflict": True, "stored_sha256": existing["content_sha256"], "file_sha256": sha})
                else:
                    report.skipped += 1
                continue
            cur.execute(
                "INSERT INTO imported_docs (doc_id, provenance, content_sha256, doc_json) VALUES (%(d)s, %(p)s, %(s)s, %(j)s::jsonb)",
                {"d": doc_id, "p": "legacy-json", "s": sha, "j": raw.decode("utf-8")},
            )
        report.imported += 1
        report.sources.append({"file": path.name, "sha256": sha})
    conn.commit()
    return report


def import_run_log(conn: psycopg.Connection, log_path: Path) -> ImportReport:
    """read-only import of the engine-runs.jsonl log; original run ids kept,
    legacy numbers stored verbatim (no recompute, no new Runs)"""
    report = ImportReport()
    if not log_path.exists():
        return report
    raw_all = log_path.read_bytes()
    report.sources.append({"file": log_path.name, "sha256": _sha256(raw_all)})
    for line_no, line in enumerate(raw_all.decode("utf-8", "replace").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
            run_id = record["runId"]
        except (ValueError, KeyError):
            report.errors += 1  # a corrupt line loses ONLY itself (engine_persist parity)
            report.sources.append({"file": log_path.name, "line": line_no, "error": "invalid JSONL line"})
            continue
        sha = _sha256(line.encode("utf-8"))
        result_json = json.dumps(record.get("result"), ensure_ascii=False) if record.get("result") is not None else None
        with conn.cursor() as cur:
            cur.execute("SELECT content_sha256 FROM imported_runs WHERE run_id = %(r)s", {"r": run_id})
            existing = cur.fetchone()
            if existing is not None:
                if existing["content_sha256"] != sha:
                    report.conflicts += 1
                    report.sources.append({"file": log_path.name, "line": line_no, "conflict": True, "runId": run_id})
                else:
                    report.skipped += 1
                continue
            cur.execute(
                "INSERT INTO imported_runs (run_id, status, result_json, record_json, content_sha256) VALUES (%(r)s, %(st)s, %(res)s, %(rec)s::jsonb, %(s)s)",
                {
                    "r": run_id,
                    "st": str(record.get("status", "unknown")),
                    "res": result_json,
                    "rec": json.dumps(record, ensure_ascii=False),
                    "s": sha,
                },
            )
        report.imported += 1
    conn.commit()
    return report


def import_report(docs: ImportReport, runs: ImportReport) -> dict:
    """combined, verifiable summary: counts + per-source content hashes"""
    runs_dict = runs.to_dict()
    run_sources = [s for s in runs_dict["sources"] if s.get("sha256")]
    return {
        "docs": docs.to_dict(),
        "runs": {**runs_dict, "source": run_sources[0] if run_sources else None},
    }
