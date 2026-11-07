"""J1.1 — the persistent task ledger for parse jobs, and the real queue it
feeds.

PG is the AUTHORITY: one research_tasks row per parse, append-only
job_attempts rows for every lifecycle transition, outbox_events as the
durable event stream. Redis/RQ only DELIVERS work: a separate worker process
(server.parse_worker) consumes `paper2lab:parse`. Delivery is at-least-once —
every state change is an atomic conditional UPDATE, so a duplicate delivery,
a cancelled task or a settled task is never re-run or overwritten. Lost queue
messages (Redis flush/restart without persistence, a failed enqueue) are
rebuilt from the ledger by reconcile_queued (worker + API startup).

J1.1 scope (registered in STATE): a worker dying MID-task leaves the task
`running` until J1.2 leases/fencing; cancelling a RUNNING task is J1.3.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any

import psycopg

QUEUE_NAME = "paper2lab:parse"
WORKER_FUNC = "server.parse_worker.run_parse_task"
# RQ's own records only need to outlive a reconcile pass — the ledger keeps
# the history; these bound what accumulates in Redis
RQ_RESULT_TTL_S = 3600
RQ_FAILURE_TTL_S = 7 * 24 * 3600
_LIVE_RQ_STATES = frozenset({"queued", "started", "deferred", "scheduled"})
_FINAL_EVENT = {True: "task.succeeded", False: "task.failed"}
_FINAL_STATUS = {True: "succeeded", False: "failed"}


def redis_url() -> str | None:
    return os.environ.get("PAPER2LAB_REDIS_URL") or None


def redis_conn() -> Any:
    """a Redis client for the configured queue, or None when unconfigured"""
    url = redis_url()
    if not url:
        return None
    import redis as _redis

    return _redis.Redis.from_url(url, socket_connect_timeout=3, socket_timeout=10)


def queue_enabled() -> bool:
    """the queue-backed parse path needs BOTH the ledger and the queue"""
    return bool(os.environ.get("PAPER2LAB_DATABASE_URL") and redis_url())


def rq_job_id(task_id: int) -> str:
    """deterministic: one task ⇒ one RQ job id (reconcile can find it)"""
    return f"p2l-parse-{task_id}"


def job_timeout_s() -> int:
    """RQ's death penalty is a BACKSTOP above the worker's own kill-on-timeout
    (PAPER2LAB_INGEST_TIMEOUT) — RQ must never be the first to fire"""
    try:
        ingest = float(os.environ.get("PAPER2LAB_INGEST_TIMEOUT", "600"))
    except ValueError:
        ingest = 600.0
    return int(ingest) + 120


def _event(cur: Any, task_id: int, event_type: str, body: dict[str, Any] | None = None) -> None:
    cur.execute(
        "INSERT INTO outbox_events (task_id, event_type, body) VALUES (%(t)s, %(e)s, %(b)s::jsonb)",
        {"t": task_id, "e": event_type, "b": json.dumps(body or {}, ensure_ascii=False)},
    )


def create_task(conn: psycopg.Connection, *, kind: str, payload: dict[str, Any]) -> int:
    """a queued task + its first attempt row + the queued outbox event, in one
    transaction"""
    raw = json.dumps(payload, ensure_ascii=False)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO research_tasks (kind, payload) VALUES (%(k)s, %(p)s::jsonb) RETURNING id",
            {"k": kind, "p": raw},
        )
        task_id = int(cur.fetchone()["id"])
        cur.execute("INSERT INTO job_attempts (task_id, status) VALUES (%(t)s, 'queued')", {"t": task_id})
        _event(cur, task_id, "task.queued", payload)
    conn.commit()
    return task_id


def enqueue_task(conn: psycopg.Connection, r: Any, task_id: int, *, requeue: bool = False) -> bool:
    """push a ledger task onto the RQ queue — idempotently. An RQ job that is
    still live AND actually present in the queue is left alone (repeated
    reconciles never double-enqueue); a stale record (finished/failed, or a
    'queued' hash whose queue entry was lost) is replaced. Returns True when a
    job was pushed."""
    from rq import Queue
    from rq.job import Job

    queue = Queue(QUEUE_NAME, connection=r)
    job_id = rq_job_id(task_id)
    if Job.exists(job_id, connection=r):
        status = Job.fetch(job_id, connection=r).get_status(refresh=True)
        state = str(getattr(status, "value", status))
        if state in _LIVE_RQ_STATES and (state != "queued" or queue.get_job_position(job_id) is not None):
            return False
        Job.fetch(job_id, connection=r).delete()
    queue.enqueue_call(
        WORKER_FUNC,
        args=(task_id,),
        job_id=job_id,
        timeout=job_timeout_s(),
        result_ttl=RQ_RESULT_TTL_S,
        failure_ttl=RQ_FAILURE_TTL_S,
    )
    with conn.cursor() as cur:
        cur.execute("UPDATE research_tasks SET rq_job_id = %(j)s WHERE id = %(t)s", {"j": job_id, "t": task_id})
        if requeue:
            _event(cur, task_id, "task.requeued", {"rqJobId": job_id})
    conn.commit()
    return True


def reconcile_queued(conn: psycopg.Connection, r: Any) -> list[int]:
    """restart reconciler: every task the LEDGER still holds as queued gets a
    live RQ job — the queue is rebuilt from PG after Redis lost messages.
    Idempotent (see enqueue_task). Returns the task ids actually re-pushed.

    One bad queue record must never abort the pass (review finding,
    reproduced on RQ 3.0.0: for ~60s after an abandoned job's execution
    record expires, deleting the stale job raises "Execution … not found",
    which crashed worker startup and dropped every other task). Such a task
    is logged and stays queued in the ledger for a later reconcile."""
    # kind filter: the ledger is shared with the Node science worker (J1.2a,
    # kind='science' — delivered by pg-boss, never by RQ); only parse tasks are
    # this reconciler's to re-push
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM research_tasks WHERE kind = 'parse' AND status = 'queued' ORDER BY id")
        task_ids = [int(row["id"]) for row in cur.fetchall()]
    conn.commit()
    requeued: list[int] = []
    for task_id in task_ids:
        try:
            if enqueue_task(conn, r, task_id, requeue=True):
                requeued.append(task_id)
        except Exception as exc:  # noqa: BLE001 — skipped, visible, retried later
            conn.rollback()  # discard this task's partial work only
            print(
                f"[paper2lab] reconcile skipped task {task_id} (left queued for a later pass): {exc!r}",
                file=sys.stderr,
                flush=True,
            )
    return requeued


def claim_task(conn: psycopg.Connection, task_id: int, *, worker: str) -> dict[str, Any] | None:
    """atomic queued→running claim. A duplicate delivery, a cancelled task or
    a settled task is NOT re-run: the losing delivery is recorded as a
    task.delivery_skipped event and None is returned."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE research_tasks SET status = 'running', started_at = now() WHERE id = %(t)s AND kind = 'parse' AND status = 'queued' RETURNING payload",
            {"t": task_id},
        )
        row = cur.fetchone()
        if row is None:
            cur.execute("SELECT status FROM research_tasks WHERE id = %(t)s", {"t": task_id})
            current = cur.fetchone()
            if current is not None:
                _event(cur, task_id, "task.delivery_skipped", {"status": current["status"], "worker": worker})
            conn.commit()
            return None
        cur.execute(
            "INSERT INTO job_attempts (task_id, status, detail) VALUES (%(t)s, 'running', %(d)s)",
            {"t": task_id, "d": worker},
        )
        _event(cur, task_id, "task.running", {"worker": worker})
    conn.commit()
    return row["payload"]


def set_stage(conn: psycopg.Connection, task_id: int, stage: str) -> None:
    """advisory progress (warming | parsing) on a running task"""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE research_tasks SET stage = %(s)s WHERE id = %(t)s AND status = 'running'",
            {"s": stage, "t": task_id},
        )
    conn.commit()


def finish_task(conn: psycopg.Connection, task_id: int, *, succeeded: bool, result: dict[str, Any], commit: bool = True) -> bool:
    """atomic running→succeeded|failed with the structured result. Never
    overwrites a state another transition already settled (returns False).

    commit=False: the CALLER owns the transaction — it commits on True and
    must roll back on False (this function never ends a transaction it did
    not open; an implicit rollback would also raise inside a
    conn.transaction() block)."""
    raw = json.dumps(result, ensure_ascii=False)
    final = _FINAL_STATUS[succeeded]
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE research_tasks SET status = %(s)s, result = %(r)s::jsonb, finished_at = now() WHERE id = %(t)s AND status = 'running' RETURNING id",
            {"s": final, "r": raw, "t": task_id},
        )
        if cur.fetchone() is None:
            if commit:
                conn.commit()
            return False
        detail = "" if succeeded else str(result.get("error") or "")[:500]
        cur.execute(
            "INSERT INTO job_attempts (task_id, status, detail) VALUES (%(t)s, %(s)s, %(d)s)",
            {"t": task_id, "s": final, "d": detail},
        )
        _event(cur, task_id, _FINAL_EVENT[succeeded], result)
    if commit:
        conn.commit()
    return True


def cancel_queued(conn: psycopg.Connection, task_id: int, *, reason: str) -> bool:
    """atomic queued→cancelled (latest-wins supersede). False when a worker
    already claimed it — cancelling a RUNNING task is J1.3."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE research_tasks SET status = 'cancelled', finished_at = now() WHERE id = %(t)s AND status = 'queued' RETURNING id",
            {"t": task_id},
        )
        if cur.fetchone() is None:
            conn.commit()
            return False
        cur.execute(
            "INSERT INTO job_attempts (task_id, status, detail) VALUES (%(t)s, 'cancelled', %(d)s)",
            {"t": task_id, "d": reason[:500]},
        )
        _event(cur, task_id, "task.cancelled", {"reason": reason})
    conn.commit()
    return True


def get_task(conn: psycopg.Connection, task_id: int) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, kind, status, stage, result, payload FROM research_tasks WHERE id = %(t)s",
            {"t": task_id},
        )
        row = cur.fetchone()
    conn.commit()
    return row


def queued_position(conn: psycopg.Connection, task_id: int) -> int:
    """1-based position among the ledger's queued parse tasks (self + every
    older queued task) — the UI's "前面还有 N-1 个任务" reads this"""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) AS n FROM research_tasks WHERE kind = 'parse' AND status = 'queued' AND id <= %(t)s",
            {"t": task_id},
        )
        position = int(cur.fetchone()["n"])
    conn.commit()
    return position
