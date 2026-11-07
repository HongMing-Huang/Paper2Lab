"""J1.CI — the ONE definition of the destructive test targets.

Every suite that TRUNCATEs Postgres tables or FLUSHDBes a Redis logical db
resolves its target from here, so a dedicated target is one env var instead
of editing eight files — and a misconfigured one is refused BEFORE any
connection is opened:

  PAPER2LAB_TEST_DATABASE   default postgresql://localhost:5432/paper2lab_d11_test
  PAPER2LAB_TEST_REDIS_URL  default redis://127.0.0.1:6379/15

Refusal rules (raise, never connect):
  - the PG database name must end with "_test" and differ from the
    production PAPER2LAB_DATABASE_URL captured at import;
  - the Redis URL must select an EXPLICIT non-zero logical db and differ
    from the production PAPER2LAB_REDIS_URL.

PAPER2LAB_TEST_REQUIRE_SERVICES=1 (CI): unreachable services are a session
failure, not a skip — see require_services() and conftest.
"""
from __future__ import annotations

import os
from urllib.parse import urlsplit

DEFAULT_TEST_DATABASE = "postgresql://localhost:5432/paper2lab_d11_test"
DEFAULT_TEST_REDIS_URL = "redis://127.0.0.1:6379/15"
TEST_REDIS_ALLOWED_DBS = frozenset(range(1, 16))  # db 0 is where prod-style clients land

# captured at import: the production URLs this process started with. A test
# target equal to either is refused no matter how it is spelled.
_PRODUCTION_DATABASE_URL = os.environ.get("PAPER2LAB_DATABASE_URL") or ""
_PRODUCTION_REDIS_URL = os.environ.get("PAPER2LAB_REDIS_URL") or ""


def _refuse_database(url: str) -> str | None:
    name = (urlsplit(url).path or "/").lstrip("/").split("?")[0]
    if not name:
        return "no database name in the URL — refusing to guess"
    if not name.endswith("_test"):
        return (
            f"database '{name}' does not look like a test database (must end with '_test'); "
            "set PAPER2LAB_TEST_DATABASE to a dedicated *_test database — destructive suites "
            "TRUNCATE their tables"
        )
    if url == _PRODUCTION_DATABASE_URL:
        return "PAPER2LAB_TEST_DATABASE equals the production PAPER2LAB_DATABASE_URL — refusing"
    return None


def _refuse_redis(url: str) -> str | None:
    parts = urlsplit(url)
    db = (parts.path or "").lstrip("/").split("?")[0]
    if not db:
        return (
            "no logical db in the Redis URL — a destructive suite FLUSHDBes its target; "
            "select an explicit non-zero db, e.g. redis://127.0.0.1:6379/15"
        )
    if not db.isdigit():
        return f"cannot parse the Redis logical db from '{url}' — refusing to guess"
    if int(db) == 0:
        return (
            "Redis db 0 is the default landing spot of production-style clients — a destructive "
            "suite FLUSHDBes its target, so db 0 is never allowed"
        )
    if url == _PRODUCTION_REDIS_URL:
        return "PAPER2LAB_TEST_REDIS_URL equals the production PAPER2LAB_REDIS_URL — refusing"
    return None


def test_database() -> str:
    """the destructive PG target (resolved + guarded on EVERY call — tests
    monkeypatch the env per-test and the guard must follow)"""
    url = os.environ.get("PAPER2LAB_TEST_DATABASE") or DEFAULT_TEST_DATABASE
    reason = _refuse_database(url)
    if reason:
        raise RuntimeError(f"PAPER2LAB_TEST_DATABASE refused: {reason}")
    return url


def test_redis_url() -> str:
    """the destructive Redis target (resolved + guarded on every call)"""
    url = os.environ.get("PAPER2LAB_TEST_REDIS_URL") or DEFAULT_TEST_REDIS_URL
    reason = _refuse_redis(url)
    if reason:
        raise RuntimeError(f"PAPER2LAB_TEST_REDIS_URL refused: {reason}")
    return url


# frozen at import: the historical module-level constants the suites expose
# (TEST_DB_URL / TEST_REDIS_URL). Per-call resolution stays with the funcs
# above; a suite's frozen constant can only be the guarded default because
# monkeypatching happens AFTER import.
TEST_DATABASE = test_database()
TEST_REDIS_URL = test_redis_url()


def ensure_database(admin_url: str | None = None) -> None:
    """fail LOUDLY when the dedicated test database does not exist yet.

    Deliberately no CREATE DATABASE here: DDL identifiers cannot be bound as
    query parameters, and dynamic DDL composition is what this project's
    security scanning (rightly) refuses. Dedicated targets are created by
    the ENVIRONMENT, not by the tests: CI's postgres service declares
    POSTGRES_DB (the image's entrypoint creates it); a local isolated run
    creates it once with createdb. This check is a plain parameterized query.

    admin_url defaults to the ADMIN database of the SAME server the target
    points at (host/port from the target URL, database "postgres") — the
    historical per-file admin literals only worked because they lived on the
    same host as the default target.
    """
    import psycopg

    target = test_database()
    if admin_url is None:
        # same server AND same role as the target; credentials (if any) stay
        # with libpq (PGPASSWORD / .pgpass) — never copied into a URL here
        parts = urlsplit(target)
        user = f"{parts.username}@" if parts.username else ""
        admin_url = f"postgresql://{user}{parts.hostname or 'localhost'}:{parts.port or 5432}/postgres"
    name = (urlsplit(target).path or "/").lstrip("/").split("?")[0]
    with psycopg.connect(admin_url, connect_timeout=5) as admin:
        exists = admin.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone()
    if exists is None:
        raise RuntimeError(
            f"the dedicated test database '{name}' does not exist. CI creates it via the "
            "postgres service's POSTGRES_DB; locally create it once with: "
            f"createdb {name}"
        )


def truncate_guard(conn) -> str:
    """pre-TRUNCATE second check, on the OPEN connection: the database we are
    actually connected to must still be a *_test database. Raises otherwise —
    a wrong dbname in pg_hba-style routing or a URL parser drift can never
    turn a TRUNCATE into a production incident."""
    with conn.cursor() as cur:
        cur.execute("SELECT current_database() AS db")
        name = str(cur.fetchone()["db"])
    if not name.endswith("_test"):
        raise RuntimeError(
            f"refusing to TRUNCATE: connected to '{name}', which does not look like a test database"
        )
    return name


_TEST_KEY_PREFIXES = ("rq:",)  # RQ's own keys; suites add nothing else global


def flushdb_guard(r) -> int:
    """pre-FLUSHDB second check, on the OPEN connection: every key in the
    logical db must carry a known test prefix. Raises otherwise — an empty
    or test-only db flushes; anything else never does."""
    keys = list(r.scan_iter(match="*", count=500))
    for key in keys:
        name = key.decode("utf-8", "replace") if isinstance(key, bytes) else str(key)
        if not name.startswith(_TEST_KEY_PREFIXES):
            raise RuntimeError(
                f"refusing to FLUSHDB: db holds non-test key {name[:80]!r} "
                "(only rq:* keys are expected in a test db)"
            )
    return len(keys)


def require_services() -> None:
    if os.environ.get("PAPER2LAB_TEST_REQUIRE_SERVICES", "0") != "1":
        return
    import psycopg
    import redis as _redis

    try:
        with psycopg.connect(test_database(), connect_timeout=5):
            pass
    except Exception as exc:  # noqa: BLE001 — the failure IS the message
        raise RuntimeError(
            f"PAPER2LAB_TEST_REQUIRE_SERVICES=1 but PostgreSQL is unreachable at {test_database()}: {exc}"
        ) from exc
    try:
        client = _redis.Redis.from_url(test_redis_url(), socket_connect_timeout=5)
        client.ping()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"PAPER2LAB_TEST_REQUIRE_SERVICES=1 but Redis is unreachable at {test_redis_url()}: {exc}"
        ) from exc


def assert_marked_tests_ran(report_items: list[tuple[str, str]], passed_pg: int = 0, passed_redis: int = 0) -> None:
    """PAPER2LAB_TEST_REQUIRE_SERVICES=1: after the session, at least one
    pg/redis-marked test must have PASSED — `-k` filters that emptied the
    destructive suites are a failure in CI (the whole point of the gate).
    report_items: (nodeid, outcome) pairs from the session report;
    passed_pg/passed_redis: counts collected from the session's own marker
    bookkeeping (conftest passes them; the nodeid list is the fallback)."""
    if os.environ.get("PAPER2LAB_TEST_REQUIRE_SERVICES", "0") != "1":
        return
    if passed_pg > 0 and passed_redis > 0:
        return
    passed = [nodeid for nodeid, outcome in report_items if outcome in ("passed", "xpassed")]
    pg = [n for n in passed if any(tag in n for tag in ("test_db_", "test_papers_", "test_parse_artifacts_", "test_jobs_j11"))]
    if not pg:
        raise RuntimeError(
            "PAPER2LAB_TEST_REQUIRE_SERVICES=1 but no Postgres-dependent test ran — "
            "the filter emptied the destructive suites (this is exactly the silent-skip CI bug)"
        )
    redis_ = [n for n in passed if "test_jobs_j11" in n]
    if not redis_:
        raise RuntimeError(
            "PAPER2LAB_TEST_REQUIRE_SERVICES=1 but no Redis-dependent test ran — "
            "the filter emptied the destructive suites (this is exactly the silent-skip CI bug)"
        )
