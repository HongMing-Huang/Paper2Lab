"""Paper2Lab backend: Docling ingestion (async jobs), document query,
Research Orchestrator sessions, health/readiness, and optional static hosting
of the built frontend (dist/) for single-origin deployment.

Run:  server/.venv/bin/uvicorn server.main:app --port 8787
Vite dev proxies /api → 127.0.0.1:8787. Jobs/docs persist under server/data/.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from server.agent import router as agent_router
from server.ingest_core import convert_pdf

app = FastAPI(title="Paper2Lab backend", version="0.3")
app.include_router(agent_router)

DATA_DIR = Path(os.environ.get("PAPER2LAB_DATA_DIR", Path(__file__).parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
INGEST_TIMEOUT_S = float(os.environ.get("PAPER2LAB_INGEST_TIMEOUT", "600"))

# ---------------------------------------------------------------- job store
# Docling models are heavy and not thread-safe → conversions run one at a
# time in a worker thread; the lock prevents unbounded duplicate heavy work.
_ingest_lock = asyncio.Lock()


def _job_path(job_id: str) -> Path:
    return DATA_DIR / f"job-{job_id}.json"


def _doc_path(doc_id: str) -> Path:
    return DATA_DIR / f"doc-{doc_id}.json"


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return None


class IngestJob:
    def __init__(self, job_id: str, filename: str) -> None:
        self.job_id = job_id
        self.filename = filename
        self.status: str = "pending"  # pending | running | done | error
        self.created_at = time.time()
        self.finished_at: float | None = None
        self.error: str | None = None
        self.result: dict[str, Any] | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "filename": self.filename,
            "status": self.status,
            "createdAt": self.created_at,
            "finishedAt": self.finished_at,
            "error": self.error,
            "docId": self.result.get("docId") if self.result else None,
        }

    def persist(self) -> None:
        _job_path(self.job_id).write_text(json.dumps(self.to_json()))

    def persist_doc(self) -> None:
        if self.result:
            _doc_path(self.result["docId"]).write_text(json.dumps(self.result))


# restart recovery: finished jobs/docs come back from disk; a job whose
# process died mid-run stays in its last persisted state (queryable, honest)
_jobs: dict[str, IngestJob] = {}


def _restore_jobs() -> None:
    for path in DATA_DIR.glob("job-*.json"):
        data = _load_json(path)
        if not data:
            continue
        job = IngestJob(str(data.get("jobId") or path.stem.removeprefix("job-")), str(data.get("filename", "")))
        job.status = str(data.get("status", "error"))
        job.created_at = float(data.get("createdAt", 0))
        job.finished_at = data.get("finishedAt")
        job.error = data.get("error")
        # a running/pending job died with the process — no task is recreated,
        # so it must surface as interrupted instead of "running" forever
        if job.status in ("pending", "running"):
            job.status = "error"
            job.error = "interrupted by server restart"
            job.finished_at = time.time()
            job.persist()
        doc = _load_json(_doc_path(str(data.get("docId")))) if data.get("docId") else None
        job.result = doc
        _jobs[job.job_id] = job


_restore_jobs()


def _get_doc(doc_id: str) -> dict[str, Any] | None:
    return _load_json(_doc_path(doc_id))


# ---------------------------------------------------------------- endpoints


@app.get("/api/health")
def health() -> dict:
    """Liveness: the process answers at all. No dependency checks."""
    return {"ok": True}


@app.get("/api/ready")
async def ready() -> dict:
    """Readiness: every dependency the API promises is actually usable."""
    checks: dict[str, dict[str, Any]] = {}
    try:
        import docling

        checks["docling"] = {"ok": True, "version": getattr(docling, "__version__", "?")}
    except Exception as exc:  # noqa: BLE001
        checks["docling"] = {"ok": False, "error": str(exc)}
    from server.agent import backend_name

    checks["agent"] = {"ok": True, "backend": backend_name()}
    try:  # storage must be writable or persistence promises are lies
        probe = DATA_DIR / ".ready-probe"
        probe.write_text("ok")
        probe.unlink()
        checks["storage"] = {"ok": True, "dir": str(DATA_DIR)}
    except Exception as exc:  # noqa: BLE001
        checks["storage"] = {"ok": False, "error": str(exc)}
    ready = all(c["ok"] for c in checks.values())
    return JSONResponse({"ready": ready, "checks": checks}, status_code=200 if ready else 503)


async def _read_bounded(file: UploadFile) -> bytes:
    """Stream the upload in bounded chunks; abort the moment the cap is crossed.

    Reading the whole body first (the old `await file.read()`) materialized
    an arbitrarily large file before the 25 MB check ran — the advertised
    limit did not protect memory at all.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"PDF exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit")
        chunks.append(chunk)
    return b"".join(chunks)


@app.post("/api/ingest", status_code=202)
async def ingest(file: UploadFile = File(...)) -> dict:
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="only PDF is supported in 0.1")
    payload = await _read_bounded(file)
    if not payload.startswith(b"%PDF"):
        raise HTTPException(status_code=422, detail="file is not a valid PDF")

    job_id = uuid.uuid4().hex[:12]
    job = IngestJob(job_id, file.filename or "upload.pdf")
    job.status = "running"
    job.persist()
    _jobs[job_id] = job

    tmp_path = DATA_DIR / f"upload-{job_id}.pdf"
    tmp_path.write_bytes(payload)

    async def run() -> None:
        try:
            loop = asyncio.get_running_loop()
            # thread-level serialization: cancelling the asyncio future on
            # timeout does NOT stop the docling thread — this lock stays held
            # until the thread actually exits, so a timed-out conversion can
            # never overlap the next one (DocumentConverter is not thread-safe)
            done = asyncio.Event()

            def convert() -> dict[str, Any]:
                try:
                    return convert_pdf(str(tmp_path), title_hint=os.path.splitext(job.filename)[0])
                finally:
                    loop.call_soon_threadsafe(done.set)

            async def serialized() -> dict[str, Any]:
                fut = loop.run_in_executor(None, convert)
                try:
                    return await fut
                finally:
                    # even if the await was cancelled (timeout), wait for the
                    # thread to finish before releasing the docling slot
                    if not fut.done():
                        await done.wait()

            async with _ingest_lock:  # one docling conversion at a time
                result = await asyncio.wait_for(serialized(), timeout=INGEST_TIMEOUT_S)
            job.result = result
            job.status = "done"
            job.finished_at = time.time()
            job.persist_doc()
        except asyncio.TimeoutError:
            job.status = "error"
            job.error = f"docling exceeded {INGEST_TIMEOUT_S}s"
            job.finished_at = time.time()
        except Exception as exc:  # noqa: BLE001 — parser errors are job results
            job.status = "error"
            job.error = f"docling failed: {exc}"
            job.finished_at = time.time()
        finally:
            job.persist()
            # delete the upload only once no conversion can still be reading it
            if job.status != "error" or not job.error or "exceeded" not in job.error:
                tmp_path.unlink(missing_ok=True)
            else:
                # timed-out conversion may still hold the file open; retry the
                # delete a bit later (best effort — the temp dir is not public)
                loop = asyncio.get_event_loop()
                loop.call_later(60, lambda: tmp_path.unlink(missing_ok=True))

    asyncio.get_event_loop().create_task(run())
    return {"jobId": job_id, "status": "running"}


@app.get("/api/ingest/{job_id}")
def ingest_status(job_id: str) -> dict:
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"unknown job: {job_id}")
    out = job.to_json()
    if job.result:
        out["document"] = job.result
    return out


@app.get("/api/document/{doc_id}")
def document(doc_id: str) -> dict:
    doc = _get_doc(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"unknown document: {doc_id}")
    return doc


# ------------------------------------------------------- production statics
_dist = Path(__file__).parent.parent / "dist"
# resolve once; every static response must stay inside this root
_dist_root = _dist.resolve()


def _safe_dist_file(full_path: str) -> Path | None:
    """Resolve a SPA path to a file inside dist/, or None.

    Path-traversal guard: `GET /../server/agent.py` used to escape dist via
    the fallback route and serve backend source (reproduced). Resolve the
    joined path and require containment within the dist root — symlinked
    targets outside dist are rejected the same way.
    """
    if not full_path:
        return None
    try:
        candidate = (_dist / full_path).resolve()
    except (OSError, ValueError):
        return None
    if candidate == _dist_root or _dist_root not in candidate.parents:
        return None
    if not candidate.is_file():
        return None
    return candidate


if _dist.is_dir():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(_dist / "index.html")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str) -> FileResponse:
        served = _safe_dist_file(full_path)
        if served is not None:
            return FileResponse(served)
        # unknown or escaping paths get the SPA shell (same as a fresh route)
        return FileResponse(_dist / "index.html")
