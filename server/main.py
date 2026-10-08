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
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
import shutil

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from server.agent import router as agent_router
from server.engine_api import router as engine_router
# offline deployments (#15 user report): pin BEFORE docling/HF imports so a
# pre-warmed cache is used and the Hub is never contacted ("Network is
# unreachable / snapshot not found" is a cold-cache problem, not a bug)
if os.environ.get("PAPER2LAB_DOCLING_OFFLINE", "0") == "1":
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from server.engine_bridge import bridge
from server.ingest_core import convert_pdf


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # NO startup warmup: on serverless (ModelScope FC) the instance is frozen
    # ~130s after the last request and a background child becomes a zombie —
    # the next request then waited on it and blew the gateway window. The
    # engine boots lazily per request; the prebuilt bundle boots in <1s and
    # the bridge fast-probes/replaces stale children (see engine_bridge).
    try:
        yield
    finally:
        await bridge.stop()
        await _warm_worker.stop()  # killable-ingest child goes down with the app


app = FastAPI(title="Paper2Lab backend", version="0.4", lifespan=_lifespan)
app.include_router(agent_router)
app.include_router(engine_router)

DATA_DIR = Path(os.environ.get("PAPER2LAB_DATA_DIR", Path(__file__).parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
INGEST_TIMEOUT_S = float(os.environ.get("PAPER2LAB_INGEST_TIMEOUT", "600"))


def _ingest_timeout_s() -> float:
    """live-read (#31): the module constant freezes at import — tests and
    config changes must take effect per conversion, not per process"""
    try:
        return float(os.environ.get("PAPER2LAB_INGEST_TIMEOUT", str(INGEST_TIMEOUT_S)))
    except ValueError:
        return INGEST_TIMEOUT_S

# ---------------------------------------------------------------- job store
# Docling models are heavy and not thread-safe → conversions run one at a
# time in a worker thread; the lock prevents unbounded duplicate heavy work.
_ingest_lock = asyncio.Lock()
_ingest_lock_loop: asyncio.AbstractEventLoop | None = None


def _ingest_guard() -> asyncio.Lock:
    """module-level Lock binds to its FIRST event loop — pytest gives every
    test a new loop and a contended acquire from another loop raises. Rebuild
    per running loop (sequential owners keep mutual exclusion; same pattern
    as engine_bridge._guard)."""
    global _ingest_lock, _ingest_lock_loop
    loop = asyncio.get_running_loop()
    if _ingest_lock_loop is not loop:
        _ingest_lock = asyncio.Lock()
        _ingest_lock_loop = loop
    return _ingest_lock


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
    if shutil.which("node"):
        status = bridge.status()
        # #31: health-200 is not functional acceptance — ready must prove the
        # engine actually ANSWERS (bounded ping; kill-switch for cold paths
        # that deliberately lazy-boot). A zombie child (alive, silent) fails.
        engine_ok = True
        engine_error: str | None = None
        if os.environ.get("PAPER2LAB_READY_ENGINE_PING", "1") != "0":
            try:
                pong = await asyncio.wait_for(bridge.call("ping"), timeout=8.0)
                engine_ok = bool(pong.get("ok"))
                if not engine_ok:
                    engine_error = "engine ping rejected"
            except Exception as exc:  # noqa: BLE001 — any ping failure = not ready
                engine_ok = False
                engine_error = f"engine ping failed: {type(exc).__name__}: {exc}"[:200]
        checks["engine"] = {
            "ok": engine_ok,
            "booted": bridge.alive(),
            "node": shutil.which("node"),
            **({"pingError": engine_error} if engine_error else {}),
            **({"lastError": status["lastError"]} if status["lastError"] else {}),
        }
    else:
        checks["engine"] = {"ok": False, "error": "node runtime not found"}
    # #31: offline deployments must ship the Docling model artifacts; when the
    # flag is set (Docker sets it), ready FAILS if the artifacts path is
    # missing/empty instead of silently downloading on the first parse.
    if os.environ.get("PAPER2LAB_REQUIRE_MODEL_ARTIFACTS", "0") == "1":
        # single mechanism (#43 hotfix): ALL docling models live in the HF hub
        # cache under HF_HOME — check for docling model entries there
        # (artifacts_path-based layouts missed the hub-downloaded models)
        try:
            hf_home = os.environ.get("HF_HOME") or str(Path.home() / ".cache" / "huggingface")
            hub = Path(hf_home) / "hub"
            models = sorted(p.name for p in hub.glob("models--docling-project--*")) if hub.exists() else []
            if models:
                checks["doclingModels"] = {"ok": True, "cache": hf_home, "models": models[:6]}
            else:
                checks["doclingModels"] = {
                    "ok": False,
                    "error": f"docling models not pre-downloaded under {hub}",
                }
        except Exception as exc:  # noqa: BLE001
            checks["doclingModels"] = {"ok": False, "error": str(exc)[:200]}
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


class _IngestTimeout(Exception):
    """docling conversion exceeded the budget — the worker process was killed"""


class _WarmIngestWorker:
    """#31 speed + killability in ONE shape: a LONG-LIVED worker process whose
    docling converter is loaded once and reused (the per-parse spawn paid the
    full model load on every PDF — tens of seconds — and a cold cache tried
    the Hub). Per-job timeout KILLS the process; the next request respawns.
    Serialization stays with _ingest_guard as before."""

    def __init__(self) -> None:
        self._proc: asyncio.subprocess.Process | None = None
        self._rid = 0
        self._lock = asyncio.Lock()

    async def _ensure(self) -> asyncio.subprocess.Process:
        if self._proc is None or self._proc.returncode is not None:
            env = {**os.environ, "PYTHONUNBUFFERED": "1"}
            self._proc = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "server.ingest_worker",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            # wait for the ready banner (bounded — a wedged boot is replaced)
            try:
                line = await asyncio.wait_for(self._proc.stdout.readline(), timeout=30.0)
                if b"worker-ready" not in line:
                    raise RuntimeError(f"ingest worker bad banner: {line[:120]!r}")
            except asyncio.TimeoutError:
                self._proc.kill()
                self._proc = None
                raise RuntimeError("ingest worker did not boot in 30s")
        return self._proc

    async def convert(self, pdf_path: str, title_hint: str, test_mode: str) -> dict[str, Any]:
        async with self._lock:
            proc = await self._ensure()
            self._rid += 1
            rid = self._rid
            req = json.dumps(
                {"id": rid, "pdf": pdf_path, "title": title_hint, "testMode": test_mode}
            ).encode() + b"\n"
            try:
                proc.stdin.write(req)
                await proc.stdin.drain()
            except (BrokenPipeError, OSError):
                # worker died between jobs — respawn once and retry
                proc = await self._respawn()
                proc.stdin.write(req)
                await proc.stdin.drain()
            try:
                raw = await asyncio.wait_for(proc.stdout.readline(), timeout=_ingest_timeout_s())
            except asyncio.TimeoutError:
                await self._kill()
                raise _IngestTimeout(
                    f"docling exceeded {_ingest_timeout_s():.0f}s — warm worker killed (pid {proc.pid})"
                ) from None
            if not raw:
                err = await proc.stderr.read() if proc.stderr else b""
                await self._kill()
                raise RuntimeError(f"ingest worker died: {err.decode('utf-8', 'replace')[-300:]}")
            msg = json.loads(raw)
            if msg.get("id") != rid:
                # protocol desync — replace the worker and fail loudly
                await self._kill()
                raise RuntimeError(f"ingest worker response desync ({msg.get('id')} != {rid})")
            if not msg.get("ok"):
                raise RuntimeError(f"docling failed: {msg.get('error', 'unknown')}")
            return msg["result"]

    async def _respawn(self) -> asyncio.subprocess.Process:
        await self._kill()
        return await self._ensure()

    async def _kill(self) -> None:
        proc, self._proc = self._proc, None
        if proc is None:
            return
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()

    async def stop(self) -> None:
        proc, self._proc = self._proc, None
        if proc is not None and proc.stdin is not None and not proc.stdin.is_closing():
            try:
                proc.stdin.close()
            except OSError:
                pass
        if proc is not None:
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except (asyncio.TimeoutError, ProcessLookupError):
                proc.kill()


_warm_worker = _WarmIngestWorker()


async def _convert_isolated(pdf_path: str, title_hint: str, job: "IngestJob") -> dict[str, Any]:
    """#31: default path is the warm killable worker process above; the old
    thread mode stays as PAPER2LAB_INGEST_ISOLATION=thread (slot held until
    the thread truly exits)."""
    mode = os.environ.get("PAPER2LAB_INGEST_ISOLATION", "process")
    if mode == "thread":
        loop = asyncio.get_running_loop()
        done = asyncio.Event()

        def convert() -> dict[str, Any]:
            try:
                return convert_pdf(pdf_path, title_hint=title_hint)
            finally:
                loop.call_soon_threadsafe(done.set)

        fut = loop.run_in_executor(None, convert)
        try:
            return await asyncio.wait_for(fut, timeout=_ingest_timeout_s())
        except asyncio.TimeoutError as exc:
            job.status = "timeout-pending"  # thread still running: slot stays held
            job.persist()
            await done.wait()  # release the slot only after REAL work ends
            raise _IngestTimeout(f"docling exceeded {_ingest_timeout_s()}s (thread finished)") from exc

    test_mode = os.environ.get("PAPER2LAB_TEST_CONVERT", "")
    return await _warm_worker.convert(pdf_path, title_hint, test_mode)


@app.post("/api/ingest", status_code=202)
async def ingest(file: UploadFile = File(...)) -> dict:
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="only PDF is supported in 0.1")
    payload = await _read_bounded(file)
    if not payload.startswith(b"%PDF"):
        raise HTTPException(status_code=422, detail="file is not a valid PDF")

    job_id = uuid.uuid4().hex[:12]
    job = IngestJob(job_id, file.filename or "upload.pdf")
    job.status = "queued"  # the docling slot may still be busy (#31)
    job.persist()
    _jobs[job_id] = job

    tmp_path = DATA_DIR / f"upload-{job_id}.pdf"
    tmp_path.write_bytes(payload)

    async def run() -> None:
        try:
            title_hint = os.path.splitext(job.filename)[0]
            async with _ingest_guard():  # one docling conversion at a time (loop-safe)
                job.status = "running"  # queued → running only INSIDE the slot
                job.persist()
                result = await _convert_isolated(str(tmp_path), title_hint, job)
            job.result = result
            job.status = "done"
            job.finished_at = time.time()
        except _IngestTimeout as exc:
            # process isolation (#31): the worker was KILLED — the slot is
            # genuinely free and the upload file is closed; a distinct status
            # separates "timed out (terminated)" from "parser failed"
            job.status = "timeout"
            job.error = str(exc)
            job.finished_at = time.time()
        except Exception as exc:  # noqa: BLE001 — parser errors are job results
            job.status = "error"
            job.error = f"docling failed: {exc}"
            job.finished_at = time.time()
        finally:
            job.persist()
            # delete the upload only once no conversion can still be reading it.
            # process mode (default): a timeout KILLED the worker → the file is
            # closed and deletable now; thread mode may still have it open.
            if job.status in ("done", "timeout") or os.environ.get("PAPER2LAB_INGEST_ISOLATION") == "process":
                tmp_path.unlink(missing_ok=True)
            elif job.status == "timeout-pending" or (job.error and "exceeded" in job.error):
                loop = asyncio.get_event_loop()
                loop.call_later(60, lambda: tmp_path.unlink(missing_ok=True))
            else:
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
