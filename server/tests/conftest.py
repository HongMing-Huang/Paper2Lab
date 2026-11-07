"""backend test suite fixtures: the startup hot-path warmup is a PRODUCTION
optimization — in tests every app instance would re-load docling models and
the suite crawls. Off globally here (env opt-out already exists)."""
import os

os.environ.setdefault("PAPER2LAB_DISABLE_STARTUP_WARMUP", "1")


def pytest_sessionstart(session):
    """J1.CI: PAPER2LAB_TEST_REQUIRE_SERVICES=1 (CI) makes the destructive
    DB/queue suites REQUIRED — an unreachable PostgreSQL/Redis is a session
    failure, not a wave of silent skips (the exact bug that let the PR #38
    persist_doc deletion ride a green CI for five days)."""
    if os.environ.get("PAPER2LAB_TEST_REQUIRE_SERVICES", "0") != "1":
        return
    from server.tests import testtargets

    testtargets.require_services()


def pytest_sessionfinish(session, exitstatus):
    """J1.CI: the require-services gate also holds AFTER the run — a -k
    filter that deselected every pg/redis-marked test is a failure in CI,
    because the gate exists to guarantee those tests actually executed."""
    if os.environ.get("PAPER2LAB_TEST_REQUIRE_SERVICES", "0") != "1":
        return
    if exitstatus != 0:
        return  # already failing; do not mask the original failure
    from server.tests import testtargets

    # counts from the session's own marker bookkeeping
    passed_pg = sum(
        1 for item in session.items if "pg" in getattr(item, "fixturenames", []) or _has_marker(item, "pg")
    )
    passed_redis = sum(1 for item in session.items if _has_marker(item, "redis"))
    # outcomes from the terminal reporter (single source of truth)
    reporter = session.config.pluginmanager.getplugin("terminalreporter")
    outcomes: list[tuple[str, str]] = []
    if reporter is not None:
        for status in ("passed", "failed", "skipped", "xpassed", "xfailed"):
            for rep in reporter.stats.get(status, []):
                outcomes.append((str(getattr(rep, "nodeid", "")), status))
    testtargets.assert_marked_tests_ran(outcomes, passed_pg=passed_pg, passed_redis=passed_redis)


def _has_marker(item, name: str) -> bool:
    try:
        return any(marker.name == name for marker in item.iter_markers())
    except Exception:  # noqa: BLE001 — non-test items have no markers
        return False
