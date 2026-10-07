"""Isolated Docling conversion process (#31).

Usage: python -m server.ingest_worker <pdf-path> [title-hint]

Prints the ingest result JSON to stdout, exit 0 on success; on failure prints
{"error": "..."} with exit 1 (docling logs stay on stderr). The point of a
separate process: a TIMED-OUT conversion can be KILLED — a docling thread
could only be abandoned, haunting the executor pool and the serialization
slot. Test hooks (no credentials, test-only): PAPER2LAB_TEST_CONVERT
= ok | hang | crash make the worker behave deterministically for tests.
"""
import json
import os
import sys
import time


def main() -> int:
    if len(sys.argv) < 2:
        sys.stdout.write(json.dumps({"error": "usage: ingest_worker <pdf> [title]"}))
        return 2
    mode = os.environ.get("PAPER2LAB_TEST_CONVERT", "")
    if mode:
        # test hooks — deterministic behaviors for process-isolation tests
        if mode == "hang":
            time.sleep(120)
            return 0
        if mode == "crash":
            sys.stderr.write("simulated docling crash\n")
            return 3
        if mode == "ok":
            sys.stdout.write(json.dumps({"docId": "test", "title": sys.argv[2] if len(sys.argv) > 2 else "t", "ok": True}))
            return 0

    from server.ingest_core import convert_pdf

    try:
        result = convert_pdf(
            sys.argv[1],
            title_hint=sys.argv[2] if len(sys.argv) > 2 else "Untitled paper",
        )
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001 — the failure IS the payload
        sys.stdout.write(json.dumps({"error": f"{type(exc).__name__}: {exc}"[:500]}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
