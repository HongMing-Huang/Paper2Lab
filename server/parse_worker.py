"""J1.1 — the queue worker that ACTUALLY consumes parse tasks.

Run it next to the API (same PAPER2LAB_DATA_DIR / PAPER2LAB_DATABASE_URL /
PAPER2LAB_REDIS_URL; the content-addressed upload store under the data dir
is shared):

    server/.venv/bin/python -m server.parse_worker           # long-running
    server/.venv/bin/python -m server.parse_worker --burst   # drain and exit

Startup reconciles the ledger: every task PG still holds as queued gets a
live RQ job (lost queue messages are rebuilt). Each delivery claims its task
atomically (queued→running) — a duplicate delivery never parses twice. The
conversion runs in the SAME warm, killable child the API's in-process path
uses (server.ingest_runner.WarmIngestWorker): models load once and are
reused across tasks; a timeout KILLS the child (real termination) and the
next task gets a fresh one.

J1.1 scope (registered in STATE, not silently skipped): a worker that dies
MID-task leaves its task `running` until J1.2 leases/fencing; cancelling a
RUNNING task and periodic (not just start-time) reconcile are J1.3.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

from server.ingest_runner import IngestTimeout, WarmIngestWorker

ROOT = Path(__file__).resolve().parents[1]

# RQ's SimpleWorker runs every job in THIS process's main thread, one at a
# time — one persistent event loop owns the warm child's pipes for the whole
# worker lifetime (a loop per job would orphan the child's transports)
_loop: asyncio.AbstractEventLoop | None = None
_converter: WarmIngestWorker | None = None


def _run(coro: Any) -> Any:
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
    return _loop.run_until_complete(coro)


def _get_converter() -> WarmIngestWorker:
    global _converter
    if _converter is None:
        _converter = WarmIngestWorker()
    return _converter


def _data_dir() -> Path:
    return Path(os.environ.get("PAPER2LAB_DATA_DIR", ROOT / "server" / "data"))


def _finish(task_id: int, *, succeeded: bool, result: dict[str, Any]) -> None:
    from server import db, jobs

    with db.connect() as conn:
        jobs.finish_task(conn, task_id, succeeded=succeeded, result=result)


def run_parse_task(task_id: int) -> dict[str, Any]:
    """the RQ job body: claim → read the stored upload → convert in the warm
    killable child → persist document + parse artifact → settle the ledger.
    Every failure settles the task as failed with a structured result; a lost
    claim (duplicate delivery / cancelled / settled task) does nothing."""
    from server import db, jobs, parse_store

    worker = f"worker pid={os.getpid()}"
    with db.connect() as conn:
        payload = jobs.claim_task(conn, task_id, worker=worker)
    if payload is None:
        return {"taskId": task_id, "skipped": True}

    tmp_path: str | None = None
    try:
        sha = str(payload.get("sha256") or "")
        content = db.artifact_bytes(sha, storage_root=_data_dir()) if sha else None
        if content is None:
            raise RuntimeError(f"upload blob missing from the store: {sha or '(no sha)'}")
        fd, tmp_path = tempfile.mkstemp(prefix=f"parse-{task_id}-", suffix=".pdf", dir=_data_dir())
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)

        def on_stage(stage: str) -> None:
            try:
                with db.connect() as stage_conn:
                    jobs.set_stage(stage_conn, task_id, stage)
            except Exception:  # noqa: BLE001 — progress is advisory; the terminal state is not
                pass

        result = _run(
            _get_converter().convert(
                tmp_path,
                str(payload.get("title") or "Untitled paper"),
                os.environ.get("PAPER2LAB_TEST_CONVERT", ""),
                on_stage,
            )
        )
    except IngestTimeout as exc:
        _finish(task_id, succeeded=False, result={"kind": "timeout", "error": str(exc), "killedPid": exc.killed_pid})
        return {"taskId": task_id, "status": "failed", "kind": "timeout"}
    except Exception as exc:  # noqa: BLE001 — the failure IS the task result
        message = str(exc) if str(exc).startswith("docling failed") else f"docling failed: {exc}"
        _finish(task_id, succeeded=False, result={"kind": "error", "error": message[:2000]})
        return {"taskId": task_id, "status": "failed", "kind": "error"}
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)

    try:
        # ONE transaction: document + parse artifact + task settlement commit
        # together (review finding) — a persist failure can never leave an
        # orphan document with a failed task
        with db.connect() as conn:
            parse_store.persist_parse_result(
                conn,
                result,
                paper_id=payload.get("paperId"),
                version_id=payload.get("versionId"),
                mode=str(payload.get("mode") or "docling"),
                commit=False,
            )
            if not jobs.finish_task(conn, task_id, succeeded=True, result={"docId": result.get("docId")}, commit=False):
                # another transition already settled the task: discard this
                # attempt's document/artifact writes — nothing becomes visible
                # (J1.2 fencing will also record the lost settlement)
                conn.rollback()
                return {"taskId": task_id, "status": "lost"}
            conn.commit()
    except Exception as exc:  # noqa: BLE001 — a failed commit unit is a visible task failure
        # one label for the whole unit (document + artifact + settlement are
        # one transaction); the underlying cause is kept verbatim
        _finish(task_id, succeeded=False, result={"kind": "error", "error": f"result commit failed: {exc}"[:2000]})
        return {"taskId": task_id, "status": "failed", "kind": "error"}
    return {"taskId": task_id, "status": "succeeded"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="server.parse_worker", description="Paper2Lab parse-queue worker (J1.1)")
    parser.add_argument("--burst", action="store_true", help="drain the queue and exit")
    args = parser.parse_args(argv)

    from server import db, jobs

    if not os.environ.get("PAPER2LAB_DATABASE_URL"):
        print("parse worker needs PAPER2LAB_DATABASE_URL (the task ledger)", file=sys.stderr)
        return 2
    redis_client = jobs.redis_conn()
    if redis_client is None:
        print("parse worker needs PAPER2LAB_REDIS_URL (the task queue)", file=sys.stderr)
        return 2
    redis_client.ping()  # an unreachable queue fails loudly, never idles

    # restart reconcile: the queue is rebuilt from the ledger before consuming
    with db.connect() as conn:
        requeued = jobs.reconcile_queued(conn, redis_client)
    if requeued:
        print(f"parse worker: re-queued {len(requeued)} task(s) from the ledger: {requeued}", file=sys.stderr)

    from rq import Queue, SimpleWorker

    # SimpleWorker: jobs run in THIS process, so the warm converter child (and
    # its loaded models) survives across tasks; the per-task timeout kill is
    # ours — RQ's death penalty (jobs.job_timeout_s) is only a backstop
    worker = SimpleWorker([Queue(jobs.QUEUE_NAME, connection=redis_client)], connection=redis_client)
    try:
        worker.work(burst=args.burst, logging_level="WARNING")
    finally:
        if _converter is not None:
            _run(_converter.stop())
        if _loop is not None and not _loop.is_closed():
            _loop.close()
    return 0


def cli_entry(argv: list[str] | None = None) -> None:
    """process entry (also the multiprocessing target in tests): the exit
    code is main()'s return value"""
    raise SystemExit(main(argv))


if __name__ == "__main__":
    cli_entry()
