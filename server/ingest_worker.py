"""Warm, KILLABLE Docling worker process (#31 speed + offline fix).

Long-lived line-protocol worker: the converter is loaded ONCE and reused for
every request (the old per-parse spawn paid the full docling model load on
EVERY conversion — tens of seconds); the parent still enforces per-job
timeouts and can KILL the whole process on overrun (a hung parse dies, the
next request gets a fresh worker).

Protocol (one JSON object per line, both directions):
  request : {"id": <int>, "pdf": <path>, "title": <str>, "testMode": "ok"|"hang"|"crash"|"", "pages": [first, last]|null}
  response: {"id": <int>, "ok": true, "result": {...}} | {"id": <int>, "ok": false, "error": "..."}

Offline (#15 user report): when PAPER2LAB_DOCLING_OFFLINE=1 the worker sets
HF_HUB_OFFLINE=1 BEFORE importing docling — combined with a pre-populated
HF cache or DOCLING_ARTIFACTS_PATH this removes the
"Network is unreachable / cannot find snapshot on the Hub" failure entirely.
"""
from __future__ import annotations

import json
import os
import sys
import time


def _setup_offline() -> None:
    if os.environ.get("PAPER2LAB_DOCLING_OFFLINE", "0") == "1":
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")


_setup_offline()


_pipeline_ready = False


def warm_convert(pdf: str, title_hint: str, notify, page_range=None) -> dict:
    """convert via server.ingest_core.convert_pdf — ONE shared code path; the
    converter is cached in THIS process (ingest_core._converter), so only the
    first request pays the docling model load. `notify(stage)` lets the parent
    surface warming vs parsing (#15 UX).

    Spans are same-process monotonic durations (never subtracted across
    processes): import and model init are measured apart from the conversion,
    and `cold` says whether THIS request paid for them."""
    global _pipeline_ready
    sys.path.insert(0, os.getcwd())
    spans: list[dict] = []
    cold = not _pipeline_ready

    started = time.perf_counter()
    from server import ingest_core
    from docling.datamodel.settings import settings

    settings.debug.profile_pipeline_timings = True
    spans.append({"name": "docling.import", "ms": round((time.perf_counter() - started) * 1000)})

    if cold:
        notify("warming")
        started = time.perf_counter()
        ingest_core.warm_pipeline()
        spans.append({"name": "docling.model_init", "ms": round((time.perf_counter() - started) * 1000)})
        _pipeline_ready = True

    notify("parsing")
    started = time.perf_counter()
    result = ingest_core.convert_pdf(pdf, title_hint=title_hint, page_range=page_range)
    spans.append({"name": "docling.convert", "ms": round((time.perf_counter() - started) * 1000)})
    result["_timing"] = {
        "cold": cold,
        "spans": spans,
        "doclingStagesMs": result.pop("_doclingStagesMs", {}),
        "workerPid": os.getpid(),
        "sourceBytes": os.path.getsize(pdf),
    }
    return result

def main() -> int:
    print(json.dumps({"event": "worker-ready", "pid": os.getpid()}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            sys.stdout.write(json.dumps({"id": -1, "ok": False, "error": "bad request line"}) + "\n")
            sys.stdout.flush()
            continue
        rid = req.get("id", -1)
        mode = str(req.get("testMode") or "")
        try:
            if mode == "hang":
                time.sleep(300)  # killed by the parent's timeout
                sys.stdout.write(json.dumps({"id": rid, "ok": True, "result": {}}) + "\n")
                sys.stdout.flush()
                continue
            if mode == "crash":
                sys.stderr.write("simulated docling crash\n")
                return 3
            if mode != "ok":
                def notify(stage: str, _rid=rid):
                    sys.stdout.write(json.dumps({"id": _rid, "stage": stage}) + "\n")
                    sys.stdout.flush()
                pages = req.get("pages")
                page_range = (int(pages[0]), int(pages[1])) if pages else None
                result = warm_convert(str(req["pdf"]), str(req.get("title") or "Untitled paper"), notify, page_range)
            else:
                result = {"docId": "test", "title": str(req.get("title") or "t"), "ok": True}
            sys.stdout.write(json.dumps({"id": rid, "ok": True, "result": result}, ensure_ascii=False) + "\n")
        except Exception as exc:  # noqa: BLE001 — the failure IS the payload
            sys.stdout.write(
                json.dumps({"id": rid, "ok": False, "error": f"{type(exc).__name__}: {exc}"[:500]}) + "\n"
            )
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
