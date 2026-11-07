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

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
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
from server.ingest_runner import INGEST_TIMEOUT_S as _INGEST_TIMEOUT_S
from server.ingest_runner import IngestTimeout, WarmIngestWorker, ingest_timeout_s, sync_kill
from server.parse_store import persist_parse_result
from server.vlm_parse import parse_pdf_with_vlm


async def _background_warmup(worker: "_WarmIngestWorker") -> None:
    """best-effort hot-path warmup at app start (never blocks/fails boot):

    1. docling converter load via the warm worker (one REAL tiny parse) —
       makes the first user PDF skip the ~30-60s model-load stage;
    2. one once-runner engine execute — touches node + the engine bundle +
       cortex so the first scientific call isn't a ~20s cold import.
    Budget-bounded; any failure is swallowed (first request pays the cost as
    before, nothing regresses)."""
    async def _docling_warm() -> None:
        tiny = DATA_DIR / "warmup-tiny.pdf"
        if not tiny.exists():
            tiny.write_bytes(b"%PDF-1.4\n%%EOF\n")
        try:
            await asyncio.wait_for(worker.convert(str(tiny), "warmup", ""), timeout=_ingest_timeout_s())
        except Exception:  # noqa: BLE001 — warmup must never break boot
            pass

    async def _engine_warm() -> None:
        try:
            from server.engine_api import ExecuteRequest

            req = ExecuteRequest(
                skill="formula.plot",
                input={
                    "expression": ["Multiply", "a", ["Sin", "x"]],
                    "parameters": ["a", "x"],
                    "values": {"a": 1, "x": 0},
                    "independent": "x",
                    "range": [-1, 1],
                    "samples": 3,
                },
                planId="startup-warmup",
                plan={
                    "planId": "startup-warmup",
                    "skill": "formula.plot",
                    "goal": "startup warmup",
                    "metrics": [],
                    "nonClaims": [],
                },
            )
            from server import engine_api as _ea

            await asyncio.wait_for(_ea._execute_raw(req), timeout=120.0)
        except Exception:  # noqa: BLE001
            pass

    # tests (PAPER2LAB_TEST_CONVERT) and opt-outs skip the warmup — every
    # pytest app instance triggering a full model load made suites crawl
    if os.environ.get("PAPER2LAB_TEST_CONVERT") or os.environ.get("PAPER2LAB_DISABLE_STARTUP_WARMUP", "0") == "1":
        return
    await asyncio.gather(_docling_warm(), _engine_warm())


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # NO startup warmup: on serverless (ModelScope FC) the instance is frozen
    # ~130s after the last request and a background child becomes a zombie —
    # the next request then waited on it and blew the gateway window. The
    # engine boots lazily per request; the prebuilt bundle boots in <1s and
    # the bridge fast-probes/replaces stale children (see engine_bridge).
    # per-app warm worker: every app instance (every pytest loop, every
    # redeploy) gets its OWN ingest child — module-global singletons carried
    # subprocess state across closed event loops and broke shutdown
    _warm_worker = _WarmIngestWorker()
    app.state.warm_worker = _warm_worker
    # J1.1: queue-backed parses survive an API restart; tasks the ledger still
    # holds as queued but whose queue message was lost (Redis flush/restart,
    # failed enqueue) are re-queued from PG — bounded, idempotent, visible
    if os.environ.get("PAPER2LAB_DATABASE_URL") and os.environ.get("PAPER2LAB_REDIS_URL"):
        try:
            requeued = await asyncio.wait_for(asyncio.to_thread(_reconcile_parse_queue), timeout=15)
            if requeued:
                print(f"[paper2lab] parse queue: re-queued {len(requeued)} task(s) from the ledger: {requeued}", flush=True)
        except Exception as exc:  # noqa: BLE001 — the API still serves; the worker reconciles too
            print(f"[paper2lab] parse queue reconcile failed: {exc!r}", file=sys.stderr, flush=True)
    # background warmup (#15 perf): the FIRST engine request after a cold
    # start paid ~20s (node + bundle + cortex cold import) and the FIRST
    # parse paid the docling model load. Warm both now, non-blocking, with
    # a hard budget — user request #1 should land on hot paths.
    asyncio.create_task(_background_warmup(_warm_worker))
    try:
        yield
    finally:
        await _warm_worker.stop()  # killable-ingest child goes down with the app
        await bridge.stop()


app = FastAPI(title="Paper2Lab backend", version="0.4", lifespan=_lifespan)


@app.middleware("http")
async def _optional_api_token(request, call_next):
    """PAPER2LAB_API_TOKEN (env; unset = open local dev, current behavior):
    when set, every /api/* call except health/ready must present it as
    `Authorization: Bearer …` or `X-API-Token`. Self-hosted deployments and
    gateway misconfigurations must not expose provider-burning VLM parses,
    disk writes and engine execution to whoever finds the port. The SPA
    attaches the same token (build-time VITE_ var or runtime paste)."""
    token = os.environ.get("PAPER2LAB_API_TOKEN")
    if token:
        path = request.url.path
        if path.startswith("/api/") and path not in ("/api/health", "/api/ready"):
            auth = request.headers.get("authorization") or ""
            supplied = (
                auth[7:].strip() if auth.lower().startswith("bearer ")
                else request.headers.get("x-api-token", "")
            )
            if supplied != token:
                return JSONResponse({"detail": "unauthorized: missing or wrong API token"}, status_code=401)
    return await call_next(request)


app.include_router(agent_router)
app.include_router(engine_router)

DATA_DIR = Path(os.environ.get("PAPER2LAB_DATA_DIR", Path(__file__).parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
# the conversion timeout is live-read in server.ingest_runner (shared with the
# J1.1 queue worker); the aliases keep this module's call sites unchanged
INGEST_TIMEOUT_S = _INGEST_TIMEOUT_S
_ingest_timeout_s = ingest_timeout_s

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
        self.status: str = "pending"  # pending | queued | running | done | timeout | error
        # #15 UX: stage refines "running" — warming (model load) | parsing
        self.stage: str | None = None
        # parse engine for this job: docling (精读定位) | vlm (快速理解, #15 speed)
        self.mode: str = "docling"
        # latest-wins (#15): same browser tab's newer upload supersedes this
        # job — queued ones cancel, a hung running one is killed for the slot
        self.client_id: str | None = None
        self.created_at = time.time()
        self.finished_at: float | None = None
        self.error: str | None = None
        self.result: dict[str, Any] | None = None
        # D1.1: the repository round-trip record (content hash + paper/version
        # ids) and any repository failure — surfaced in the job JSON so a DB
        # problem is visible, never silent
        self.repo_record: dict[str, Any] | None = None
        self.repo_error: str | None = None
        # J1.1: a queue-backed parse is a research_task in the PG ledger,
        # consumed by a SEPARATE worker process (server.parse_worker); this
        # API process only reads its status. None ⇒ in-process parse.
        self.task_id: int | None = None
        self.queue_error: str | None = None
        # transient (never persisted): position among the ledger's queued
        # parse tasks, refreshed on each status read
        self.queue_position: int | None = None
        # CLI-151 渐进片段 (VLM path only, in-process): pages finish out of
        # order and each finished page's RAW extraction lands here so the
        # paper-study view can research over real fragments BEFORE the parse
        # settles. Never persisted — a restart simply loses the preview (the
        # settled document is the durable artifact). Docling/queue parses
        # stay empty (no page-level progress exists there — shown honestly).
        self.partial: list[dict[str, Any]] = []
        # CLI-151: inclusive 1-based pages this job parses (None = whole file)
        self.page_range: tuple[int, int] | None = None
        # phase durations for this job (same-process spans, never summed
        # across overlapping phases); no paper text and no credentials here
        self.timing: dict[str, Any] = {}

    def to_json(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "filename": self.filename,
            "status": self.status,
            "stage": self.stage,
            "mode": self.mode,
            "clientId": self.client_id,
            "createdAt": self.created_at,
            "finishedAt": self.finished_at,
            "error": self.error,
            "docId": self.result.get("docId") if self.result else None,
            # D1.1: repository round-trip visibility
            "repo": self.repo_record if self.repo_record else ({"error": self.repo_error} if self.repo_error else None),
            # J1.1: the ledger task behind a queue-backed parse, and any
            # queue/ledger problem (visible, never silent)
            "taskId": self.task_id,
            "queueError": self.queue_error,
            "pages": list(self.page_range) if self.page_range else None,
            "timing": self.timing or None,
        }

    def persist(self) -> None:
        _job_path(self.job_id).write_text(json.dumps(self.to_json()))

    def persist_doc(self) -> None:
        if not self.result:
            return
        # D1.3: with the repository configured, the documents table is the
        # ONLY write authority for parse results — no dual write to the
        # legacy JSON file. A repository failure is visible (repo_error),
        # never silently absorbed and never papered over with a JSON write.
        if os.environ.get("PAPER2LAB_DATABASE_URL"):
            try:
                from server import db as _db

                # one code path with the J1.1 queue worker (server.parse_store):
                # document + P1.2 APPEND-ONLY parse artifact (parser identity +
                # anchor precision; old artifacts never overwritten/upgraded)
                record = self.repo_record or {}
                with _db.connect() as repo_conn:
                    persist_parse_result(
                        repo_conn,
                        self.result,
                        paper_id=record.get("paper_id"),
                        version_id=record.get("version_id"),
                        mode=self.mode,
                    )
            except Exception as exc:  # noqa: BLE001 — recorded, no JSON fallback
                self.repo_error = f"document persist failed: {exc}"
        else:
            _doc_path(self.result["docId"]).write_text(json.dumps(self.result))


# restart recovery: finished jobs/docs come back from disk; a job whose
# process died mid-run stays in its last persisted state (queryable, honest)
_jobs: dict[str, IngestJob] = {}
# in-flight run() coroutines by job id — latest-wins CANCELS these instead of
# merely relabeling (a superseded VLM parse would otherwise keep burning
# provider tokens on every remaining page until it finished on its own)
_running_tasks: dict[str, "asyncio.Task[None]"] = {}
# process-wide VLM admission (review finding): the 4-page semaphore inside
# parse_pdf_with_vlm is PER JOB — N concurrent uploads used to issue 4×N
# provider calls at once. This shared gate caps concurrent VLM JOBS.
_vlm_jobs_sem: asyncio.Semaphore | None = None
_vlm_jobs_sem_loop: asyncio.AbstractEventLoop | None = None


def _max_concurrent_vlm_jobs() -> int:
    try:
        return max(1, int(os.environ.get("PAPER2LAB_MAX_VLM_JOBS", "2")))
    except ValueError:
        return 2


def _vlm_jobs_guard() -> asyncio.Semaphore:
    """same loop-affinity pattern as _ingest_guard — a Semaphore binds to its
    first event loop and pytest gives every test a fresh one."""
    global _vlm_jobs_sem, _vlm_jobs_sem_loop
    loop = asyncio.get_running_loop()
    if _vlm_jobs_sem_loop is not loop:
        _vlm_jobs_sem = asyncio.Semaphore(_max_concurrent_vlm_jobs())
        _vlm_jobs_sem_loop = loop
    return _vlm_jobs_sem


def _restore_jobs() -> None:
    for path in DATA_DIR.glob("job-*.json"):
        data = _load_json(path)
        if not data:
            continue
        job = IngestJob(str(data.get("jobId") or path.stem.removeprefix("job-")), str(data.get("filename", "")))
        job.status = str(data.get("status", "error"))
        job.stage = data.get("stage")
        job.mode = str(data.get("mode") or "docling")
        job.client_id = data.get("clientId")
        job.created_at = float(data.get("createdAt", 0))
        job.finished_at = data.get("finishedAt")
        job.error = data.get("error")
        job.timing = data.get("timing") or {}
        task_id = data.get("taskId")
        job.task_id = int(task_id) if isinstance(task_id, int) else None
        # an IN-PROCESS job that was pending/queued/running died with the
        # process — no coroutine is recreated, so it must surface as
        # interrupted instead of waiting forever (a queued one used to stay
        # "queued" with nobody to run it). A QUEUE-BACKED job (J1.1) is NOT
        # interrupted: its worker is independent of this API process and its
        # status is read from the ledger.
        if job.task_id is None and job.status in ("pending", "queued", "running"):
            job.status = "error"
            job.error = "interrupted by server restart"
            job.finished_at = time.time()
            job.persist()
        # D1.3: restart recovery reads through _get_doc (PG first, legacy JSON
        # read-only fallback) — reading the file directly lost the docId for
        # DB-authority documents on restart (review finding)
        doc = _get_doc(str(data.get("docId"))) if data.get("docId") else None
        job.result = doc
        _jobs[job.job_id] = job


def _get_doc(doc_id: str) -> dict[str, Any] | None:
    # D1.3: the repository is the read path when configured; the legacy JSON
    # files remain a READ-ONLY fallback for pre-switch documents
    if os.environ.get("PAPER2LAB_DATABASE_URL"):
        try:
            from server import db as _db

            with _db.connect() as repo_conn:
                doc = _db.get_document(repo_conn, doc_id)
            if doc is not None:
                return doc
        except Exception:  # noqa: BLE001 — fall through to the legacy files
            pass
    return _load_json(_doc_path(doc_id))


# restart recovery runs AFTER _get_doc is defined (it reads through the
# repository-first path) — a module-level call above the definition crashed
# import whenever server/data held a finished job with a docId (review find)
_restore_jobs()


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


# the warm killable conversion child lives in server.ingest_runner — ONE
# implementation shared with the J1.1 queue worker (server.parse_worker)
_IngestTimeout = IngestTimeout


class _VLMUnavailable(Exception):
    """mode=vlm requested but no usable vision provider is configured — surfaced
    to the user as an explicit actionable error (never silently fall back to
    docling: the user picked the fast path because docling is slow)"""


_WarmIngestWorker = WarmIngestWorker
_sync_kill = sync_kill



def _current_warm_worker() -> "_WarmIngestWorker":
    """the per-app worker (set at lifespan startup); a fresh module-level
    fallback keeps headless scripts (no app) working"""
    return getattr(app.state, "warm_worker", None) or _fallback_worker


_fallback_worker = _WarmIngestWorker()



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
                return convert_pdf(pdf_path, title_hint=title_hint, page_range=(job.page_range if job is not None else None))
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
    on_stage = None
    if job is not None:
        def on_stage(stage: str, _job=job) -> None:
            _job.stage = stage
            _job.persist()
    kwargs = {"page_range": job.page_range} if job is not None and job.page_range else {}
    return await _current_warm_worker().convert(pdf_path, title_hint, test_mode, on_stage, **kwargs)


# ------------------------------------------- J1.1 queue-backed parse ledger
# job statuses that never change again — a queue-backed job in one of these
# is not re-read from the ledger
_LEDGER_SETTLED = frozenset({"done", "error", "timeout", "superseded", "cancelled"})


def _refresh_from_ledger(job: IngestJob) -> None:
    """J1.1: a queue-backed job's truth is the PG ledger (the parse runs in
    a separate worker process). Map task status onto the job contract the UI
    polls. A ledger read failure is visible (queueError); the last known
    state is kept rather than guessed."""
    try:
        from server import db as _db
        from server import jobs as _task_ledger

        with _db.connect() as conn:
            task = _task_ledger.get_task(conn, job.task_id)
            position = (
                _task_ledger.queued_position(conn, job.task_id)
                if task is not None and task["status"] == "queued"
                else 0
            )
    except Exception as exc:  # noqa: BLE001 — visible, state kept
        job.queue_error = f"ledger read failed: {exc}"
        return
    if task is None:
        job.queue_error = f"task {job.task_id} missing from the ledger"
        return
    job.queue_position = position
    status = str(task["status"])
    result = task.get("result") or {}
    before = (job.status, job.stage, job.error)
    if status == "queued":
        job.status = "queued"
    elif status == "running":
        job.status = "running"
        job.stage = task.get("stage")
    elif status == "succeeded":
        doc_id = str(result.get("docId") or "")
        doc = _get_doc(doc_id) if doc_id else None
        if doc is None:
            job.status = "error"
            job.error = f"worker reported docId {doc_id!r} but the document is not in the store"
        else:
            job.result = doc
            job.status = "done"
        job.finished_at = job.finished_at or time.time()
    elif status == "failed":
        job.status = "timeout" if result.get("kind") == "timeout" else "error"
        job.error = str(result.get("error") or "parse failed")
        job.finished_at = job.finished_at or time.time()
    elif status == "cancelled":
        job.status = "superseded" if job.status == "superseded" else "cancelled"
        job.finished_at = job.finished_at or time.time()
    if (job.status, job.stage, job.error) != before:
        job.persist()


def _supersede_queue_job(job: IngestJob) -> None:
    """J1.1 latest-wins for a queue-backed job, decided by the LEDGER — the
    in-memory status may be stale (nobody polled since the worker moved on):
    queued → atomically cancelled (the worker's claim then loses: the
    delivery is skipped, never parsed); running → superseded for the user
    while the worker finishes (cancelling a RUNNING queue task is J1.3);
    already settled → the settled truth is kept. A ledger failure is
    visible and changes nothing."""
    try:
        from server import db as _db
        from server import jobs as _task_ledger

        with _db.connect() as conn:
            cancelled = _task_ledger.cancel_queued(
                conn, job.task_id, reason="superseded by a newer upload from the same tab"
            )
            task = None if cancelled else _task_ledger.get_task(conn, job.task_id)
    except Exception as exc:  # noqa: BLE001 — visible on the job
        job.queue_error = f"ledger cancel failed: {exc}"
        return
    if cancelled or (task is not None and task["status"] == "running"):
        job.status = "superseded"
        job.error = "已被同一页面的新上传取代"
        job.finished_at = time.time()
        job.persist()
        return
    _refresh_from_ledger(job)


def _queue_parse_task(job: IngestJob, record: dict[str, Any]) -> None:
    """J1.1: write the ledger task and enqueue it (sync — runs off the event
    loop). job.task_id is set the moment the ledger row exists; from then on
    the LEDGER is the authority: an enqueue failure must NOT fall back
    in-process (the task would later be delivered AND parsed twice) — it
    stays queued and the next worker/API start re-queues it from PG."""
    from server import db as _ledger_db
    from server import jobs as _task_ledger

    try:
        with _ledger_db.connect() as ledger_conn:
            job.task_id = _task_ledger.create_task(
                ledger_conn,
                kind="parse",
                payload={
                    "jobId": job.job_id,
                    "title": os.path.splitext(job.filename)[0],
                    "filename": job.filename,
                    "mode": job.mode,
                    "sha256": record.get("sha256"),
                    "paperId": record.get("paper_id"),
                    "versionId": record.get("version_id"),
                },
            )
        # durable link job→task at once: an API crash before the enqueue
        # still restores this job as queue-backed (not "interrupted")
        job.persist()
    except Exception as exc:  # noqa: BLE001
        if job.task_id is None:  # no ledger row was written: in-process is safe
            job.queue_error = f"task ledger unavailable — parsed in-process: {exc}"
            return
        job.queue_error = f"ledger connection error after the task was written: {exc}"
    try:
        with _ledger_db.connect() as ledger_conn:
            _task_ledger.enqueue_task(ledger_conn, _task_ledger.redis_conn(), job.task_id)
    except Exception as exc:  # noqa: BLE001 — visible; recovered by reconcile
        job.queue_error = (
            f"enqueue failed — task stays queued in the ledger, re-queued at the next worker/API start: {exc}"
        )


def _reconcile_parse_queue() -> list[int]:
    """API-start reconcile: tasks the ledger holds as queued get a live RQ job
    again (lost queue messages are rebuilt from PG; idempotent)"""
    from server import db as _db
    from server import jobs as _task_ledger

    with _db.connect() as conn:
        return _task_ledger.reconcile_queued(conn, _task_ledger.redis_conn())


async def _supersede_client_jobs(client_id: str, new_job_id: str) -> None:
    """latest-wins (#15): a fresh upload from the SAME tab immediately
    supersedes that tab's older tasks — queued ones cancel outright; a hung
    running one gets the worker killed so the slot frees for the new task
    instead of making the user's retry queue behind their own stale job."""
    for j in list(_jobs.values()):  # snapshot: the loop awaits, _jobs may grow
        if j.client_id != client_id or j.job_id == new_job_id:
            continue
        if j.task_id is not None:
            # J1.1 queue-backed: the LEDGER decides (see _supersede_queue_job)
            if j.status in ("queued", "running"):
                await asyncio.to_thread(_supersede_queue_job, j)
            continue
        if j.status == "queued":
            j.status = "superseded"
            j.error = "已被同一页面的新上传取代"
            j.finished_at = time.time()
            j.persist()
            # the queued coroutine is parked on a slot acquire — cancel it or
            # it would LATER acquire, overwrite status back to running and
            # do the work anyway (same-tab retry would pay for both)
            task = _running_tasks.get(j.job_id)
            if task is not None and not task.done():
                task.cancel()
        elif j.status == "running":
            # mark first (the run() coroutine must not overwrite this), then
            # REALLY stop the work: cancel the coroutine (VLM page calls die
            # mid-flight instead of burning provider tokens to completion);
            # docling jobs additionally need the worker KILLED — their blocked
            # subprocess read owns real CPU that a cancel alone won't free
            j.status = "superseded"
            j.error = "已被同一页面的新上传取代"
            j.finished_at = time.time()
            j.persist()
            task = _running_tasks.get(j.job_id)
            if task is not None and not task.done():
                task.cancel()
            if j.mode == "docling":
                await _current_warm_worker().stop()


async def _convert_vlm(pdf_path: str, job: "IngestJob") -> dict[str, Any]:
    """fast-path parse (#15 speed): render pages + the provider's NATIVE
    multimodal model reads them concurrently. No docling slot is held —
    VLM jobs don't compete with 精读 jobs for the single-process slot."""
    from server.agent_provider import resolve_provider

    status = resolve_provider()
    # vision fast-path needs an OpenAI-compatible endpoint (base_url + key +
    # model); a dashscope-only config has no base_url to render pages to
    if not status.ok or status.provider != "openai" or not status.base_url:
        raise _VLMUnavailable(
            "快速理解模式需要已配置的 OpenAI 兼容视觉 provider"
            "（PAPER2LAB_AGENT_BASE_URL / API_KEY / MODEL）"
        )
    provider = {
        "base_url": status.base_url,
        "api_key": os.environ.get("PAPER2LAB_AGENT_API_KEY") or "",
        "model": status.model or "",
        "timeout_s": status.timeout_s,
    }

    def on_stage(stage: str, _job: "IngestJob" = job) -> None:
        _job.stage = stage
        _job.persist()

    def on_page(page_no: int, page_items: list[dict[str, Any]], _job: "IngestJob" = job) -> None:
        # CLI-151 progressive fragments: append the page's raw extraction as
        # a lightweight preview {page, kind, latex?/text?}. Runs on the event
        # loop (same task), so no lock is needed against the status reader.
        for it in page_items:
            frag: dict[str, Any] = {"page": page_no, "kind": str(it.get("kind") or "text")}
            if it.get("kind") == "formula":
                frag["latex"] = str(it.get("latex") or "")
            else:
                frag["text"] = str(it.get("text") or "")
            _job.partial.append(frag)

    return await asyncio.wait_for(
        parse_pdf_with_vlm(pdf_path, provider, on_stage, on_page=on_page, page_range=job.page_range),
        timeout=_ingest_timeout_s(),
    )


def _parse_page_range(pages: str | None) -> tuple[int, int] | None:
    """`pages` form field: "3" or "3-5" (1-based, inclusive). Absent means the
    whole file; anything else is the caller's error, never a silent full parse."""
    if pages is None or not pages.strip():
        return None
    first, sep, last = pages.strip().partition("-")
    if not first.isdigit() or (sep and not last.isdigit()):
        raise HTTPException(status_code=422, detail=f"invalid pages: {pages!r} (expected '3' or '3-5')")
    start = int(first)
    end = int(last) if sep else start
    if start < 1 or end < start:
        raise HTTPException(status_code=422, detail=f"invalid pages: {pages!r} (1-based, first ≤ last)")
    return (start, end)


@app.post("/api/ingest", status_code=202)
async def ingest(
    file: UploadFile = File(...),
    clientId: str | None = Form(default=None),
    mode: str = Form(default="docling"),
    identifier: str | None = Form(default=None),
    pages: str | None = Form(default=None),
) -> dict:
    if mode not in ("docling", "vlm"):
        raise HTTPException(status_code=422, detail=f"unknown parse mode: {mode}")
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="only PDF is supported in 0.1")
    page_range = _parse_page_range(pages)
    payload = await _read_bounded(file)
    if not payload.startswith(b"%PDF"):
        raise HTTPException(status_code=422, detail="file is not a valid PDF")

    job_id = uuid.uuid4().hex[:12]
    job = IngestJob(job_id, file.filename or "upload.pdf")
    job.status = "queued"  # the docling slot may still be busy (#31)
    job.mode = mode
    job.page_range = page_range
    job.timing["uploadBytes"] = len(payload)
    if clientId:
        job.client_id = clientId[:64]
        await _supersede_client_jobs(clientId, job_id)
    job.persist()
    _jobs[job_id] = job

    tmp_path = DATA_DIR / f"upload-{job_id}.pdf"
    tmp_path.write_bytes(payload)

    # D1.1: the repository round-trip for the REAL upload consumer — content-
    # addressed artifact + workspace-scoped Paper/Version with same-file dedup.
    # Opt-in via PAPER2LAB_DATABASE_URL until D1.3 switches the write
    # authority; a repository failure is recorded on the job, never silent.
    if os.environ.get("PAPER2LAB_DATABASE_URL"):
        try:
            from server import db

            with db.connect() as repo_conn:
                job.repo_record = db.store_paper_upload(
                    repo_conn,
                    workspace="default",
                    filename=file.filename or "upload.pdf",
                    content=payload,
                    storage_root=DATA_DIR,
                    identifier=(identifier or None),
                )
                got = db.get_paper_by_sha(repo_conn, workspace="default", sha256=job.repo_record["sha256"])
                if got is None:
                    raise RuntimeError("repository round-trip failed: paper row not readable after store")
                job.repo_record["readback_ok"] = True
        except Exception as exc:  # noqa: BLE001 — recorded on the job, ingest continues
            job.repo_error = str(exc)

    # J1.1: with BOTH the ledger (PG) and the queue (Redis) configured, a
    # docling parse runs in a SEPARATE worker process (server.parse_worker):
    # this endpoint writes the research_task + enqueues it, then only READS
    # status from the ledger. VLM parses stay in-process (one task kind is
    # migrated first). No ledger row ⇒ the proven in-process path below runs
    # unchanged, with the reason visible on the job (queueError). A page-scoped
    # parse stays in-process for now: the queue worker has no page contract.
    queue_path = mode == "docling" and page_range is None and bool(
        os.environ.get("PAPER2LAB_DATABASE_URL") and os.environ.get("PAPER2LAB_REDIS_URL")
    )
    record = job.repo_record or {}
    if queue_path and not record.get("sha256"):
        job.queue_error = "queue path needs the stored upload (repository unavailable) — parsed in-process"
    elif queue_path:
        await asyncio.to_thread(_queue_parse_task, job, record)
        if job.task_id is not None:
            job.status = "queued"
            job.persist()
            tmp_path.unlink(missing_ok=True)  # the worker reads the content-addressed blob
            return {
                "jobId": job_id,
                "status": "queued",
                "taskId": job.task_id,
                "queueError": job.queue_error,
                "repo": job.repo_record,
            }

    async def run() -> None:
        engine_label = mode
        slot_wait_started = time.perf_counter()
        try:
            title_hint = os.path.splitext(job.filename)[0]
            if mode == "vlm":
                # process-wide admission: at most N VLM jobs in flight (each
                # with its own 4-page concurrency) — stays "queued" until a
                # slot frees, mirroring the docling slot semantics
                async with _vlm_jobs_guard():
                    job.timing["slotWaitMs"] = round((time.perf_counter() - slot_wait_started) * 1000)
                    job.status = "running"
                    job.persist()
                    result = await _convert_vlm(str(tmp_path), job)
            else:
                async with _ingest_guard():  # one docling conversion at a time (loop-safe)
                    job.timing["slotWaitMs"] = round((time.perf_counter() - slot_wait_started) * 1000)
                    job.status = "running"  # queued → running only INSIDE the slot
                    job.persist()
                    result = await _convert_isolated(str(tmp_path), title_hint, job)
            job.timing.update(result.pop("_timing", None) or {})
            job.result = result
            job.status = "done"
            job.finished_at = time.time()
            # persist the DOCUMENT (not just the job record) — dropped by
            # mistake in #38, which made /api/document/{id} 404 and lost docs
            # on restart; caught by the real_docling lifecycle test
            job.persist_doc()
        except _VLMUnavailable as exc:
            if job.status == "superseded":
                return
            job.status = "error"
            job.error = str(exc)
            job.finished_at = time.time()
        except asyncio.CancelledError:
            # supersede (or shutdown) cancelled us mid-parse: the supersede
            # path already wrote the truth — settle WITHOUT touching job
            # state and swallow so the cancelled task doesn't surface as an
            # unretrieved-exception warning
            return
        except _IngestTimeout as exc:
            if job.status == "superseded":
                return  # a newer upload already took over — keep that truth
            # process isolation (#31): the worker was KILLED — the slot is
            # genuinely free and the upload file is closed; a distinct status
            # separates "timed out (terminated)" from "parser failed"
            job.status = "timeout"
            job.error = str(exc)
            job.finished_at = time.time()
        except Exception as exc:  # noqa: BLE001 — parser errors are job results
            if job.status == "superseded":
                return  # a newer upload already took over — keep that truth
            job.status = "error"
            job.error = f"{engine_label} failed: {exc}"
            job.finished_at = time.time()
        finally:
            _running_tasks.pop(job_id, None)
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

    _running_tasks[job_id] = asyncio.get_event_loop().create_task(run())
    # D1.1: the immediate response carries the repository round-trip record
    # (or its failure) so the consumer sees the paper identity at once
    return {
        "jobId": job_id,
        "status": "running",
        "repo": job.repo_record if job.repo_record else ({"error": job.repo_error} if job.repo_error else None),
    }


@app.get("/api/ingest/{job_id}")
def ingest_status(job_id: str) -> dict:
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"unknown job: {job_id}")
    if job.task_id is not None and job.status not in _LEDGER_SETTLED:
        _refresh_from_ledger(job)
    out = job.to_json()
    # #15 UX: the poller gets live stage, elapsed time and queue depth — a
    # static spinner for 20-60s reads as "stuck" and is the top complaint
    out["elapsedMs"] = int((time.time() - job.created_at) * 1000)
    if job.task_id is not None:
        # J1.1: the worker queue's depth comes from the LEDGER (self + older
        # queued tasks) — in-memory statuses of unpolled jobs may be stale
        out["queueDepth"] = (job.queue_position or 0) if job.status == "queued" else 0
    else:
        # the in-process docling slot queue (queue-backed jobs wait elsewhere)
        out["queueDepth"] = sum(1 for j in _jobs.values() if j.status == "queued" and j.task_id is None)
    if job.result:
        out["document"] = job.result
    elif job.status == "running" and job.partial:
        # CLI-151: progressive fragments while a VLM parse is still running —
        # the study view researches over these BEFORE the document exists
        out["partialItems"] = sorted(job.partial, key=lambda f: f.get("page", 0))
    return out


@app.get("/api/document/{doc_id}")
def document(doc_id: str) -> dict:
    doc = _get_doc(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"unknown document: {doc_id}")
    return doc


@app.get("/api/papers")
def papers() -> dict:
    """P1.1: the versioned paper library — papers with versions and per-upload
    provenance. Without the repository configured the listing is empty and
    says so honestly (no fake library over the JSON files)."""
    if not os.environ.get("PAPER2LAB_DATABASE_URL"):
        return {"repository": False, "papers": []}
    try:
        from server import db as _db

        with _db.connect() as repo_conn:
            return {"repository": True, "papers": _db.list_papers(repo_conn)}
    except Exception as exc:  # noqa: BLE001 — listing failure is visible
        raise HTTPException(status_code=502, detail=f"paper library unavailable: {exc}") from exc


@app.get("/api/papers/{paper_id}/parses")
def paper_parses(paper_id: str) -> dict:
    """P1.2: append-only parse artifact listing (parser identity + precision).
    Re-parses ADD rows; old rows keep their original anchor precision."""
    if not os.environ.get("PAPER2LAB_DATABASE_URL"):
        return {"repository": False, "parses": []}
    try:
        from server import db as _db

        with _db.connect() as repo_conn:
            return {"repository": True, "parses": _db.list_parse_artifacts(repo_conn, paper_id)}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"parse history unavailable: {exc}") from exc


@app.get("/api/papers/{paper_id}/parses/{parse_id}")
def paper_parse_detail(paper_id: str, parse_id: int) -> dict:
    """P1.2: the FULL parse JSON of one artifact — old anchors stay openable."""
    if not os.environ.get("PAPER2LAB_DATABASE_URL"):
        raise HTTPException(status_code=404, detail="no repository configured")
    try:
        from server import db as _db

        with _db.connect() as repo_conn:
            parse = _db.get_parse_artifact(repo_conn, paper_id, parse_id)
        if parse is None:
            raise HTTPException(status_code=404, detail=f"unknown parse {parse_id} for paper {paper_id}")
        return parse
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"parse history unavailable: {exc}") from exc


@app.get("/api/papers/{paper_id}/pdf")
def paper_pdf(paper_id: str) -> Response:
    """P1.1: the ORIGINAL PDF from the content-addressed store — readable
    whether the parse is still running, failed, or finished."""
    if not os.environ.get("PAPER2LAB_DATABASE_URL"):
        raise HTTPException(status_code=404, detail=f"unknown paper: {paper_id}")
    try:
        from server import db as _db

        with _db.connect() as repo_conn:
            sha = _db.paper_artifact_sha(repo_conn, paper_id)
        if sha is None:
            raise HTTPException(status_code=404, detail=f"unknown paper: {paper_id}")
        content = _db.artifact_bytes(sha, storage_root=DATA_DIR)
        if content is None:
            raise HTTPException(status_code=410, detail=f"paper blob missing from store: {sha}")
        return Response(content=content, media_type="application/pdf")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"paper store unavailable: {exc}") from exc


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
