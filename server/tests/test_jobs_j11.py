"""J1.1 — one REAL parse task runs through the persistent task ledger AND a
real queue worker: the API writes a research_task (+ queued attempt + outbox
event) and enqueues it on Redis/RQ; a SEPARATE worker process consumes it,
runs the conversion, stores the document and records every transition. The
API reads status from the ledger. Queued state is rebuilt from PG when the
queue lost its messages (Redis flush / restart) — "not just a queued row"."""
from __future__ import annotations

import io
import multiprocessing
import os
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from server import db  # noqa: E402
from server.main import app  # noqa: E402
from server.tests import testtargets  # noqa: E402

TEST_DB_URL = testtargets.TEST_DATABASE  # J1.CI: the shared, guarded test target
# a DEDICATED Redis logical db for this suite — flushing it never touches
# anything else on the host
TEST_REDIS_URL = testtargets.TEST_REDIS_URL  # J1.CI: guarded (explicit non-zero db)

REDIS_UP = False
try:
    import redis as _redis

    REDIS_UP = bool(_redis.Redis.from_url(TEST_REDIS_URL).ping())
except Exception:
    REDIS_UP = False

PG_UP = False
try:
    import psycopg

    with psycopg.connect("postgresql://localhost:5432/postgres", connect_timeout=2) as _probe:
        PG_UP = True
except Exception:
    PG_UP = False

pytestmark = [
    pytest.mark.pg,
    pytest.mark.redis,
    pytest.mark.skipif(
        not (PG_UP and REDIS_UP), reason="J1.1 needs a reachable local PostgreSQL AND Redis"
    ),
]

PDF = b"%PDF-1.4 J1.1 ledger payload " + b"j" * 64


@pytest.fixture()
def env(tmp_path, monkeypatch):
    import redis as _redis

    # J1.CI: the dedicated target must exist (CI creates it via POSTGRES_DB;
    # locally via createdb) — a loud, actionable error instead of a wedge
    testtargets.ensure_database()
    conn = db.connect(TEST_DB_URL)
    db.migrate(conn)
    conn.autocommit = True
    testtargets.truncate_guard(conn)  # J1.CI: second check on the OPEN connection
    conn.execute("TRUNCATE outbox_events, job_attempts, research_tasks, upload_events, paper_versions, papers, artifacts, workspaces, documents, parse_artifacts")
    conn.autocommit = False
    conn.close()
    _r = _redis.Redis.from_url(TEST_REDIS_URL)
    testtargets.flushdb_guard(_r)  # J1.CI: second check — only test-owned keys
    _r.flushdb()
    monkeypatch.setenv("PAPER2LAB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("PAPER2LAB_DATABASE_URL", TEST_DB_URL)
    monkeypatch.setenv("PAPER2LAB_REDIS_URL", TEST_REDIS_URL)
    monkeypatch.setenv("PAPER2LAB_DISABLE_STARTUP_WARMUP", "1")
    monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "ok")
    import server.main as main_mod

    monkeypatch.setattr(main_mod, "DATA_DIR", tmp_path)
    return tmp_path


def _upload(client: TestClient, name: str, client_id: str | None = None) -> dict:
    data = {"mode": "docling"}
    if client_id:
        data["clientId"] = client_id
    res = client.post(
        "/api/ingest",
        files={"file": (name, io.BytesIO(PDF + name.encode()), "application/pdf")},
        data=data,
    )
    assert res.status_code == 202, res.text
    return res.json()


def _run_worker(join_timeout: float = 120.0) -> int:
    """a REAL separate worker process (spawn = a fresh interpreter, its own
    pid, inheriting the test's monkeypatched environment); burst mode drains
    the queue and exits. Returns the process exit code."""
    from server import parse_worker

    proc = multiprocessing.get_context("spawn").Process(target=parse_worker.cli_entry, args=(["--burst"],))
    proc.start()
    proc.join(join_timeout)
    if proc.is_alive():
        proc.kill()
        proc.join()
        raise AssertionError(f"parse worker did not finish within {join_timeout:.0f}s")
    return int(proc.exitcode)


def _ledger(task_id: int) -> dict:
    # context-managed: a failing assertion elsewhere can never leave this
    # connection idle-in-transaction (that wedged the next TRUNCATE forever)
    with db.connect(TEST_DB_URL) as conn, conn.cursor() as cur:
        cur.execute("SELECT status, stage, result FROM research_tasks WHERE id = %(t)s", {"t": task_id})
        task = cur.fetchone()
        cur.execute("SELECT status, detail FROM job_attempts WHERE task_id = %(t)s ORDER BY id", {"t": task_id})
        attempts = cur.fetchall()
        cur.execute("SELECT event_type FROM outbox_events WHERE task_id = %(t)s ORDER BY id", {"t": task_id})
        events = [e["event_type"] for e in cur.fetchall()]
    return {"task": task, "attempts": attempts, "events": events}


def _count(table_sql: str) -> int:
    with db.connect(TEST_DB_URL) as conn, conn.cursor() as cur:
        if table_sql == "parse_artifacts":
            cur.execute("SELECT count(*) AS n FROM parse_artifacts")
        elif table_sql == "documents":
            cur.execute("SELECT count(*) AS n FROM documents")
        else:
            cur.execute("SELECT count(*) AS n FROM research_tasks")
        return int(cur.fetchone()["n"])


def _queue_count() -> int:
    import redis as _redis
    from rq import Queue

    from server import jobs as jobs_mod

    return Queue(jobs_mod.QUEUE_NAME, connection=_redis.Redis.from_url(TEST_REDIS_URL)).count


class TestWorkerConsumes:
    def test_api_only_queues_and_a_separate_worker_process_consumes(self, env):
        with TestClient(app) as client:
            submit = _upload(client, "ledger.pdf")
            assert submit["status"] == "queued" and isinstance(submit["taskId"], int)
            task_id = submit["taskId"]
            time.sleep(0.4)
            # the API process never runs the parse itself
            assert client.get(f"/api/ingest/{submit['jobId']}").json()["status"] == "queued"
            assert _ledger(task_id)["task"]["status"] == "queued"
            assert _queue_count() == 1

            assert _run_worker() == 0

            status = client.get(f"/api/ingest/{submit['jobId']}").json()
            assert status["status"] == "done", status
            assert status["docId"]
            assert client.get(f"/api/document/{status['docId']}").status_code == 200

        ledger = _ledger(task_id)
        assert ledger["task"]["status"] == "succeeded"
        assert ledger["task"]["result"]["docId"] == status["docId"]
        assert [a["status"] for a in ledger["attempts"]] == ["queued", "running", "succeeded"]
        assert ledger["events"] == ["task.queued", "task.running", "task.succeeded"]
        # cross-process proof: the consuming worker is NOT the test/API process
        running = ledger["attempts"][1]["detail"]
        assert running.startswith("worker pid=") and running != f"worker pid={os.getpid()}"
        # the parse also landed as an append-only parse artifact for the paper
        assert _count("parse_artifacts") == 1
        assert _queue_count() == 0

    def test_a_failed_parse_is_recorded_by_the_worker(self, env, monkeypatch):
        monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "crash")
        with TestClient(app) as client:
            submit = _upload(client, "boom.pdf")
            assert _run_worker() == 0
            status = client.get(f"/api/ingest/{submit['jobId']}").json()
        assert status["status"] == "error"
        assert "docling" in (status["error"] or "")
        ledger = _ledger(submit["taskId"])
        assert ledger["task"]["status"] == "failed"
        assert ledger["task"]["result"]["kind"] == "error"
        assert [a["status"] for a in ledger["attempts"]] == ["queued", "running", "failed"]
        assert ledger["events"][-1] == "task.failed"

    def test_timeout_really_terminates_the_conversion(self, env, monkeypatch):
        monkeypatch.setenv("PAPER2LAB_TEST_CONVERT", "hang")
        monkeypatch.setenv("PAPER2LAB_INGEST_TIMEOUT", "2")
        with TestClient(app) as client:
            submit = _upload(client, "slow.pdf")
            started = time.time()
            assert _run_worker() == 0
            elapsed = time.time() - started
            status = client.get(f"/api/ingest/{submit['jobId']}").json()
        assert status["status"] == "timeout", status
        assert elapsed < 60  # the 300s hang was cut, not waited out
        ledger = _ledger(submit["taskId"])
        assert ledger["task"]["status"] == "failed"
        assert ledger["task"]["result"]["kind"] == "timeout"
        # the conversion process was KILLED (real termination, not abandoned)
        killed_pid = int(ledger["task"]["result"]["killedPid"])
        with pytest.raises(ProcessLookupError):
            os.kill(killed_pid, 0)

    def test_duplicate_delivery_runs_the_parse_once(self, env):
        import redis as _redis
        from rq import Queue

        from server import jobs as jobs_mod

        with TestClient(app) as client:
            submit = _upload(client, "dup.pdf")
            # an at-least-once queue may deliver the same task twice
            Queue(jobs_mod.QUEUE_NAME, connection=_redis.Redis.from_url(TEST_REDIS_URL)).enqueue_call(
                jobs_mod.WORKER_FUNC, args=(submit["taskId"],), job_id="duplicate-delivery"
            )
            assert _queue_count() == 2
            assert _run_worker() == 0
            assert client.get(f"/api/ingest/{submit['jobId']}").json()["status"] == "done"
        ledger = _ledger(submit["taskId"])
        statuses = [a["status"] for a in ledger["attempts"]]
        assert statuses.count("running") == 1 and statuses.count("succeeded") == 1
        assert ledger["events"].count("task.delivery_skipped") == 1

    def test_a_failed_artifact_write_leaves_no_orphan_document(self, env):
        # review finding: document, parse artifact and task settlement are ONE
        # transaction — a parse artifact that cannot be written (here: an FK
        # to a paper that does not exist) must roll the document back too
        import redis as _redis

        from server import jobs as jobs_mod

        with db.connect(TEST_DB_URL) as conn:
            record = db.store_paper_upload(
                conn, workspace="default", filename="orphan.pdf", content=PDF + b"orphan", storage_root=env
            )
            task_id = jobs_mod.create_task(
                conn,
                kind="parse",
                payload={
                    "jobId": "planted",
                    "title": "orphan",
                    "mode": "docling",
                    "sha256": record["sha256"],
                    "paperId": "no-such-paper",
                    "versionId": "no-such-version",
                },
            )
            jobs_mod.enqueue_task(conn, _redis.Redis.from_url(TEST_REDIS_URL), task_id)
        assert _run_worker() == 0
        ledger = _ledger(task_id)
        assert ledger["task"]["status"] == "failed"
        # one label for the whole commit unit (document + artifact + settlement
        # are one transaction); the underlying cause is kept verbatim
        error = ledger["task"]["result"]["error"]
        assert error.startswith("result commit failed") and "parse_artifacts" in error
        assert _count("documents") == 0  # rolled back with the failed artifact write
        assert _count("parse_artifacts") == 0


class TestRebuildAndRestart:
    def test_lost_queue_messages_are_rebuilt_from_pg_when_the_worker_starts(self, env):
        import redis as _redis

        with TestClient(app) as client:
            submit = _upload(client, "lost.pdf")
            assert _queue_count() == 1
            _lost = _redis.Redis.from_url(TEST_REDIS_URL)  # Redis lost every message
            testtargets.flushdb_guard(_lost)
            _lost.flushdb()
            assert _queue_count() == 0
            assert _run_worker() == 0  # worker startup reconciles PG queued → queue
            assert client.get(f"/api/ingest/{submit['jobId']}").json()["status"] == "done"
        ledger = _ledger(submit["taskId"])
        assert "task.requeued" in ledger["events"]
        assert [a["status"] for a in ledger["attempts"]].count("running") == 1

    def test_api_restart_requeues_lost_tasks_exactly_once(self, env):
        import redis as _redis

        with TestClient(app) as client:
            submit = _upload(client, "restart.pdf")
        _wipe = _redis.Redis.from_url(TEST_REDIS_URL)
        testtargets.flushdb_guard(_wipe)
        _wipe.flushdb()
        with TestClient(app):  # API restart: lifespan reconciles queued tasks
            pass
        assert _queue_count() == 1
        with TestClient(app):  # a second restart must NOT enqueue it again
            pass
        assert _queue_count() == 1
        assert _run_worker() == 0  # the worker's own reconcile also stays idempotent
        ledger = _ledger(submit["taskId"])
        assert ledger["task"]["status"] == "succeeded"
        assert [a["status"] for a in ledger["attempts"]].count("running") == 1

    def test_one_bad_queue_record_cannot_abort_the_reconcile_pass(self, env, monkeypatch):
        # review finding (reproduced on RQ 3.0.0): for ~60s after an abandoned
        # job's execution record expires, deleting the stale job raises
        # "Execution … not found in Redis" — the unguarded reconcile crashed
        # worker startup and dropped every other task of the pass. The RQ
        # timing is injected deterministically here.
        import redis as _redis

        from server import jobs as jobs_mod

        with db.connect(TEST_DB_URL) as conn:
            bad = jobs_mod.create_task(conn, kind="parse", payload={"title": "bad"})
            good = jobs_mod.create_task(conn, kind="parse", payload={"title": "good"})
        real_enqueue = jobs_mod.enqueue_task

        def flaky_enqueue(conn, r, task_id, *, requeue=False):
            if task_id == bad:
                raise ValueError(f"Execution {jobs_mod.rq_job_id(task_id)}:x not found in Redis")
            return real_enqueue(conn, r, task_id, requeue=requeue)

        monkeypatch.setattr(jobs_mod, "enqueue_task", flaky_enqueue)
        with db.connect(TEST_DB_URL) as conn:
            requeued = jobs_mod.reconcile_queued(conn, _redis.Redis.from_url(TEST_REDIS_URL))
        assert requeued == [good]  # the pass continued past the bad record
        assert _queue_count() == 1
        assert _ledger(bad)["task"]["status"] == "queued"  # left for a later reconcile

    def test_api_restart_keeps_queue_backed_jobs_alive(self, env):
        import server.main as main_mod

        with TestClient(app) as client:
            submit = _upload(client, "survive.pdf")
        # the API process dies; the in-memory job table is rebuilt from disk
        main_mod._jobs.clear()
        main_mod._restore_jobs()
        restored = main_mod._jobs[submit["jobId"]]
        # a queue-backed job is NOT interrupted by an API restart (the worker
        # is independent) — only in-process jobs die with the API
        assert restored.status == "queued" and restored.task_id == submit["taskId"]
        assert _run_worker() == 0
        with TestClient(app) as client:
            assert client.get(f"/api/ingest/{submit['jobId']}").json()["status"] == "done"

    def test_an_in_process_queued_job_is_interrupted_by_a_restart(self, env):
        # a pre-J1.1 gap (PLAN: "queued可能留下但无人执行"): an in-process job
        # still waiting for the docling slot died with the API — no coroutine
        # is recreated, so it must surface as interrupted, not queued forever
        import json as _json

        import server.main as main_mod

        (env / "job-orphan00001.json").write_text(
            _json.dumps({"jobId": "orphan00001", "filename": "o.pdf", "status": "queued", "createdAt": 1.0})
        )
        main_mod._restore_jobs()
        orphan = main_mod._jobs["orphan00001"]
        assert orphan.status == "error" and orphan.error == "interrupted by server restart"


class TestSupersedeAndFallback:
    def test_a_superseded_queued_task_is_cancelled_and_never_parsed(self, env):
        with TestClient(app) as client:
            first = _upload(client, "first.pdf", client_id="tab-1")
            second = _upload(client, "second.pdf", client_id="tab-1")
            assert client.get(f"/api/ingest/{first['jobId']}").json()["status"] == "superseded"
            assert _run_worker() == 0
            assert client.get(f"/api/ingest/{first['jobId']}").json()["status"] == "superseded"
            assert client.get(f"/api/ingest/{second['jobId']}").json()["status"] == "done"
        first_ledger = _ledger(first["taskId"])
        assert first_ledger["task"]["status"] == "cancelled"
        assert "running" not in [a["status"] for a in first_ledger["attempts"]]
        assert "task.cancelled" in first_ledger["events"]

    def test_a_finished_but_never_polled_task_is_not_relabelled_superseded(self, env):
        # the worker finished the first task while nobody polled it (the API's
        # in-memory status is stale "queued"); a same-tab retry must read the
        # LEDGER, not the stale status — a completed parse stays done
        with TestClient(app) as client:
            first = _upload(client, "finished.pdf", client_id="tab-2")
            assert _run_worker() == 0
            _upload(client, "retry.pdf", client_id="tab-2")
            assert client.get(f"/api/ingest/{first['jobId']}").json()["status"] == "done"
        assert _ledger(first["taskId"])["task"]["status"] == "succeeded"

    def test_queue_depth_counts_ledger_tasks_ahead(self, env):
        with TestClient(app) as client:
            first = _upload(client, "a.pdf", client_id="tab-a")
            second = _upload(client, "b.pdf", client_id="tab-b")
            # the UI shows "前面还有 queueDepth-1 个任务" — self + tasks ahead
            assert client.get(f"/api/ingest/{first['jobId']}").json()["queueDepth"] == 1
            assert client.get(f"/api/ingest/{second['jobId']}").json()["queueDepth"] == 2

    def test_without_redis_the_in_process_path_is_unchanged(self, env, monkeypatch):
        monkeypatch.delenv("PAPER2LAB_REDIS_URL")
        with TestClient(app) as client:
            submit = _upload(client, "inproc.pdf")
            deadline = time.time() + 30
            status = {}
            while time.time() < deadline:
                status = client.get(f"/api/ingest/{submit['jobId']}").json()
                if status["status"] in ("done", "error", "timeout"):
                    break
                time.sleep(0.05)
        assert status["status"] == "done"
        assert _count("research_tasks") == 0  # no ledger semantics without a queue

    def test_the_worker_refuses_to_start_without_a_queue(self, env, monkeypatch, capfd):
        monkeypatch.delenv("PAPER2LAB_REDIS_URL")
        assert _run_worker() == 2
        assert "PAPER2LAB_REDIS_URL" in capfd.readouterr().err


class TestRealParse:
    def test_real_docling_paper_is_parsed_by_the_queue_worker(self, env, monkeypatch):
        """the REAL parse task (PLAN J1.1 gate): an actual paper PDF through
        the queue worker's warm docling child — named real_docling so the
        quick CI set (-k "not real_docling") excludes it like the other
        model-loading tests; the daily full job runs it"""
        monkeypatch.delenv("PAPER2LAB_TEST_CONVERT")
        # the warm model cache, never the Hub: the first run of this test
        # failed on a flaky SOCKS proxy during docling's Hub check (recorded
        # honestly as a failed task); offline mode is the documented
        # deployment setting and ci-daily pre-warms the cache
        monkeypatch.setenv("PAPER2LAB_DOCLING_OFFLINE", "1")
        pdf = (ROOT / "public" / "papers" / "ode-lotka-volterra.pdf").read_bytes()
        with TestClient(app) as client:
            res = client.post(
                "/api/ingest",
                files={"file": ("ode-lotka-volterra.pdf", io.BytesIO(pdf), "application/pdf")},
                data={"mode": "docling"},
            )
            assert res.status_code == 202, res.text
            submit = res.json()
            assert submit["status"] == "queued"
            assert _run_worker(join_timeout=600) == 0
            status = client.get(f"/api/ingest/{submit['jobId']}").json()
        assert status["status"] == "done", status
        document = status["document"]
        assert document["engine"] == "docling"
        formulas = [item for item in document["items"] if item.get("kind") == "formula"]
        assert len(formulas) >= 2  # the paper's two governing equations
        ledger = _ledger(submit["taskId"])
        assert [a["status"] for a in ledger["attempts"]] == ["queued", "running", "succeeded"]
        assert ledger["task"]["stage"] == "parsing"  # the worker relayed warming → parsing
        with db.connect(TEST_DB_URL) as conn, conn.cursor() as cur:
            cur.execute("SELECT parser, anchor_precision FROM parse_artifacts")
            artifact = cur.fetchone()
        assert artifact["parser"] == "docling" and artifact["anchor_precision"] == "region"
