"""The warm, KILLABLE docling conversion child — ONE implementation shared by
the API's in-process parse path (server.main) and the J1.1 queue worker
(server.parse_worker), so the line protocol and the kill-on-timeout
semantics can never drift between the two executors.

Moved verbatim from server.main (#31 speed + killability); the only addition
is IngestTimeout.killed_pid, which lets the queue ledger prove the
conversion process was really terminated.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from typing import Any

INGEST_TIMEOUT_S = float(os.environ.get("PAPER2LAB_INGEST_TIMEOUT", "600"))


def ingest_timeout_s() -> float:
    """live-read (#31): the module constant freezes at import — tests and
    config changes must take effect per conversion, not per process"""
    try:
        return float(os.environ.get("PAPER2LAB_INGEST_TIMEOUT", str(INGEST_TIMEOUT_S)))
    except ValueError:
        return INGEST_TIMEOUT_S


class IngestTimeout(Exception):
    """the conversion overran the timeout and its process was KILLED"""

    def __init__(self, message: str, killed_pid: int | None = None) -> None:
        super().__init__(message)
        self.killed_pid = killed_pid


class WarmIngestWorker:
    """#31 speed + killability in ONE shape: a LONG-LIVED worker process whose
    docling converter is loaded once and reused (the per-parse spawn paid the
    full model load on every PDF — tens of seconds — and a cold cache tried
    the Hub). Per-job timeout KILLS the process; the next request respawns.
    Serialization stays with the caller's slot guard as before."""

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

    async def convert(
        self, pdf_path: str, title_hint: str, test_mode: str,
        on_stage=None,
        page_range: tuple[int, int] | None = None,
    ) -> dict[str, Any]:
        """on_stage(stage) fires when the worker reports warming/parsing so the
        job (and the UI) can tell model-load from actual parsing (#15 UX)."""
        wait_started = time.perf_counter()
        async with self._lock:
            lock_wait_ms = round((time.perf_counter() - wait_started) * 1000)
            proc = await self._ensure()
            self._rid += 1
            rid = self._rid
            req = json.dumps(
                {
                    "id": rid,
                    "pdf": pdf_path,
                    "title": title_hint,
                    "testMode": test_mode,
                    "pages": list(page_range) if page_range else None,
                }
            ).encode() + b"\n"
            try:
                proc.stdin.write(req)
                await proc.stdin.drain()
            except (BrokenPipeError, OSError):
                # worker died between jobs — respawn once and retry
                proc = await self._respawn()
                proc.stdin.write(req)
                await proc.stdin.drain()
            loop = asyncio.get_event_loop()
            deadline = loop.time() + ingest_timeout_s()
            msg: dict[str, Any] = {}
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    await self._kill()
                    raise IngestTimeout(
                        f"docling exceeded {ingest_timeout_s():.0f}s — warm worker killed (pid {proc.pid})",
                        killed_pid=proc.pid,
                    )
                try:
                    raw = await asyncio.wait_for(proc.stdout.readline(), timeout=remaining)
                except asyncio.TimeoutError:
                    await self._kill()
                    raise IngestTimeout(
                        f"docling exceeded {ingest_timeout_s():.0f}s — warm worker killed (pid {proc.pid})",
                        killed_pid=proc.pid,
                    ) from None
                if not raw:
                    err = await proc.stderr.read() if proc.stderr else b""
                    await self._kill()
                    raise RuntimeError(f"ingest worker died: {err.decode('utf-8', 'replace')[-300:]}")
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if msg.get("stage"):
                    if on_stage:
                        on_stage(str(msg["stage"]))
                    continue
                if msg.get("id") != rid:
                    # protocol desync — replace the worker and fail loudly
                    await self._kill()
                    raise RuntimeError(f"ingest worker response desync ({msg.get('id')} != {rid})")
                break
            if not msg.get("ok"):
                raise RuntimeError(f"docling failed: {msg.get('error', 'unknown')}")
            result = msg["result"]
            timing = result.get("_timing")
            if isinstance(timing, dict):
                # time behind another conversion (or the startup warmup) on
                # this one worker — otherwise it reads as parsing time
                timing["workerLockWaitMs"] = lock_wait_ms
            return result

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
        if proc is None:
            return
        if proc.stdin is not None and not proc.stdin.is_closing():
            try:
                proc.stdin.close()
            except OSError:
                pass
        try:
            await asyncio.wait_for(proc.wait(), timeout=5)
        except (asyncio.TimeoutError, ProcessLookupError):
            sync_kill(proc)
        except RuntimeError:
            # the child belongs to a CLOSED event loop (app restarted between
            # tests / redeploys) — its transport can't be awaited here; reap
            # synchronously instead of failing the app shutdown
            sync_kill(proc)


def sync_kill(proc: asyncio.subprocess.Process) -> None:
    """best-effort reaping when the child's loop is gone: SIGKILL now; the OS
    reaps it (or pytest's process exit does). No await on a dead loop."""
    try:
        proc.kill()
    except ProcessLookupError:
        pass
