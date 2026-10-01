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


@app.post("/api/ingest", status_code=202)
async def ingest(file: UploadFile = File(...)) -> dict:
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="only PDF is supported in 0.1")
    payload = await file.read()
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"PDF exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit")
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
            async with _ingest_lock:  # one docling conversion at a time
                result = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda: convert_pdf(str(tmp_path), title_hint=os.path.splitext(job.filename)[0]),
                    ),
                    timeout=INGEST_TIMEOUT_S,
                )
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
            tmp_path.unlink(missing_ok=True)

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
if _dist.is_dir():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(_dist / "index.html")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str) -> FileResponse:
        candidate = _dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
