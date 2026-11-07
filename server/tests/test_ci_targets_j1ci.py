"""Tests for the shared, configurable DB/Redis test targets (J1.CI).

Contract under test (CLI-144):
- all destructive suites resolve their PG database and Redis logical db from
  env (PAPER2LAB_TEST_DATABASE / PAPER2LAB_TEST_REDIS_URL) with the SAME
  defaults as before, so nothing changes for existing runs;
- testtargets is the one definition the suites import (no per-file literals
  drift — asserted by importing every destructive suite module);
- the guard refuses non-test targets: a production-looking
  PAPER2LAB_TEST_DATABASE (or a shared Redis db) fails BEFORE any connection
  is opened, with an actionable message;
- a dedicated Redis db outside the shared 15 is accepted (e.g. CI's own).
"""
from __future__ import annotations

import importlib
import multiprocessing
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from server.tests import testtargets  # noqa: E402


def _resolve_in_fresh_process(root: str, out) -> None:  # pragma: no cover - child body
    """runs in a SPAWNED interpreter (its own env view, like the worker)"""
    import sys as _sys

    _sys.path.insert(0, root)
    from server.tests import testtargets as t

    out.put(f"{t.test_database()} {t.test_redis_url()}")


class TestDefaultsUnchanged:
    """the defaults hold when NO dedicated target is configured — under a
    configured dedicated target these are trivially different BY DESIGN"""

    def test_default_pg_database_is_the_historical_test_db(self, monkeypatch):
        monkeypatch.delenv("PAPER2LAB_TEST_DATABASE", raising=False)
        assert testtargets.test_database() == "postgresql://localhost:5432/paper2lab_d11_test"

    def test_default_redis_is_db15(self, monkeypatch):
        monkeypatch.delenv("PAPER2LAB_TEST_REDIS_URL", raising=False)
        assert testtargets.test_redis_url() == "redis://127.0.0.1:6379/15"

    def test_the_frozen_constants_are_the_guarded_defaults(self):
        # module-level constants freeze at import; with a dedicated target
        # configured they legitimately hold that target, never a literal
        assert testtargets.TEST_DATABASE == testtargets.test_database()
        assert testtargets.TEST_REDIS_URL == testtargets.test_redis_url()

    def test_a_fresh_interpreter_resolves_the_same_targets(self):
        # the parse worker subprocess / a spawned pytest must resolve the
        # same targets as this process — whatever they are in this run
        ctx = multiprocessing.get_context("spawn")
        out = ctx.Queue()
        proc = ctx.Process(target=_resolve_in_fresh_process, args=(str(ROOT), out))
        proc.start()
        proc.join(60)
        assert proc.exitcode == 0
        assert out.get(timeout=5) == f"{testtargets.test_database()} {testtargets.test_redis_url()}"


class TestEnvOverrides:
    def test_a_dedicated_database_is_honoured(self, monkeypatch):
        # the dedicated name must itself pass the *_test guard — the guard
        # applies to dedicated targets too, not only to defaults
        monkeypatch.setenv("PAPER2LAB_TEST_DATABASE", "postgresql://localhost:5432/paper2lab_ci_probe_test")
        assert testtargets.test_database() == "postgresql://localhost:5432/paper2lab_ci_probe_test"

    def test_a_dedicated_redis_url_is_honoured(self, monkeypatch):
        monkeypatch.setenv("PAPER2LAB_TEST_REDIS_URL", "redis://127.0.0.1:6379/4")
        assert testtargets.test_redis_url() == "redis://127.0.0.1:6379/4"

    def test_every_destructive_suite_module_uses_the_shared_targets(self):
        suites = [
            "server.tests.test_db_d1",
            "server.tests.test_db_consumer_d1",
            "server.tests.test_db_d13",
            "server.tests.test_db_import_d12",
            "server.tests.test_papers_p11",
            "server.tests.test_papers_p13",
            "server.tests.test_parse_artifacts_p12",
            "server.tests.test_jobs_j11",
        ]
        for name in suites:
            mod = importlib.import_module(name)
            assert mod.TEST_DB_URL == testtargets.TEST_DATABASE, f"{name} does not use the shared PG target"
            if hasattr(mod, "TEST_REDIS_URL"):
                assert mod.TEST_REDIS_URL == testtargets.TEST_REDIS_URL, f"{name} does not use the shared Redis target"


class TestRefusesNonTestTargets:
    @pytest.mark.parametrize(
        "url",
        [
            "postgresql://localhost:5432/postgres",
            "postgresql://localhost/paper2lab",
            "postgresql://localhost:5432/paper2lab_prod",
        ],
    )
    def test_a_production_looking_database_is_refused_before_connecting(self, monkeypatch, url):
        monkeypatch.setenv("PAPER2LAB_TEST_DATABASE", url)
        with pytest.raises(RuntimeError, match="PAPER2LAB_TEST_DATABASE"):
            testtargets.test_database()

    def test_a_shared_redis_db_is_refused_before_connecting(self, monkeypatch):
        # db 0 (the prod-style default landing spot) and "no db at all" are
        # refused unconditionally; ANY explicit db is fine in isolation —
        # it is only refused when it equals this run's production URL
        for url in ("redis://127.0.0.1:6379/0", "redis://127.0.0.1:6379"):
            monkeypatch.setenv("PAPER2LAB_TEST_REDIS_URL", url)
            with pytest.raises(RuntimeError, match="PAPER2LAB_TEST_REDIS_URL"):
                testtargets.test_redis_url()
        monkeypatch.setenv("PAPER2LAB_TEST_REDIS_URL", "redis://127.0.0.1:6379/3")
        # the equality rule compares against the production URL captured at
        # IMPORT time — monkeypatching the env alone must not be able to
        # change it (that would let any late env edit bypass the guard), so
        # the test patches the captured constant itself
        monkeypatch.setattr(testtargets, "_PRODUCTION_REDIS_URL", "redis://127.0.0.1:6379/3")
        with pytest.raises(RuntimeError, match="production PAPER2LAB_REDIS_URL"):
            testtargets.test_redis_url()
        monkeypatch.delenv("PAPER2LAB_TEST_REDIS_URL")

    def test_the_refusal_happens_at_resolution_time(self, monkeypatch):
        # refusing at RESOLUTION time means no code path can even construct
        # a client to the refused target (no connect/ping side effect) — the
        # other tests in this class already assert the raise happens purely
        # from parsing; this one pins the intent for reviewers
        monkeypatch.setenv("PAPER2LAB_TEST_DATABASE", "postgresql://prod.example.com:5432/paper2lab")
        with pytest.raises(RuntimeError):
            testtargets.test_database()
