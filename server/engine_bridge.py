"""Engine bridge — manages the long-lived Node engine process so the backend
can execute registered scientific skills headless through the SAME unified
executor the browser runs (scripts/engine_server.ts).

Protocol: newline-delimited JSON on the child's stdio; every response echoes
the request id. Requests are awaited by id (the engine processes them
strictly in order, keeping run lineage deterministic).

The child is spawned lazily on first use, restarted if it dies, and shut
down on FastAPI teardown. No credentials, no network access in the child —
it only ever sees JSON skill requests validated by the executor itself.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
ENGINE_SCRIPT = REPO_ROOT / "scripts" / "engine_server.ts"
REQUEST_TIMEOUT_S = float(os.environ.get("PAPER2LAB_ENGINE_TIMEOUT", "120"))
BOOT_TIMEOUT_S = 20.0


class EngineBridge:
    def __init__(self) -> None:
        self._proc: subprocess.Popen[bytes] | None = None
        self._lock = asyncio.Lock()
        self._next_id = 0
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._reader: asyncio.Task[None] | None = None
        self._drain: asyncio.Task[None] | None = None
        self._last_error: str | None = None
        self._started_at: float | None = None

    # ------------------------------------------------------------ lifecycle
    async def _boot(self) -> None:
        env = dict(os.environ)
        env.setdefault("NODE_NO_WARNINGS", "1")
        self._proc = subprocess.Popen(
            ["node", "--import", "tsx", str(ENGINE_SCRIPT)],
            cwd=REPO_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )
        self._started_at = time.time()
        # Popen pipes are BLOCKING file objects — reads must run in worker
        # threads or they would stall the event loop for every engine call.
        self._reader = asyncio.create_task(self._read_loop())

        async def _drain_stderr() -> None:
            assert self._proc and self._proc.stderr
            while True:
                line = await asyncio.to_thread(self._proc.stderr.readline)
                if not line:
                    return
                text = line.decode("utf-8", "replace").rstrip()
                if text:
                    self._last_error = text[-2000:]

        self._drain = asyncio.get_running_loop().create_task(_drain_stderr())
        # wait for the engine-ready banner (or first response) before serving
        deadline = time.monotonic() + BOOT_TIMEOUT_S
        while time.monotonic() < deadline:
            pong = await self._roundtrip({"op": "ping"}, timeout=BOOT_TIMEOUT_S)
            if pong.get("ok"):
                return
        raise RuntimeError("engine did not become ready in time")

    async def start(self) -> None:
        async with self._lock:
            if self._proc is None or self._proc.poll() is not None:
                await self._boot()

    async def stop(self) -> None:
        proc, self._proc = self._proc, None
        reader, self._reader = self._reader, None
        drain, self._drain = self._drain, None
        for task in (reader, drain):
            if task:
                task.cancel()
        if proc is None:
            return
        if proc.stdin and not proc.stdin.closed:
            try:
                proc.stdin.write(b'{"op":"shutdown"}\n')
                proc.stdin.flush()
                proc.stdin.close()
            except OSError:
                pass
        try:
            await asyncio.to_thread(proc.wait, 5)
        except subprocess.TimeoutExpired:
            proc.kill()

    def alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def status(self) -> dict[str, Any]:
        return {
            "ok": self.alive(),
            "startedAt": self._started_at,
            "lastError": self._last_error,
        }

    # ------------------------------------------------------------ wire
    async def _read_loop(self) -> None:
        proc = self._proc
        if not proc or not proc.stdout:
            return
        while True:
            line = await asyncio.to_thread(proc.stdout.readline)
            if not line:
                break
            text = line.decode("utf-8", "replace").strip()
            if not text:
                continue
            try:
                msg = json.loads(text)
            except json.JSONDecodeError:
                self._last_error = f"unparseable engine line: {text[:200]}"
                continue
            if msg.get("event") == "engine-ready":
                continue
            fut = self._pending.pop(int(msg.get("id", -1)), None)
            if fut is not None and not fut.done():
                fut.set_result(msg)

    async def _roundtrip(self, request: dict[str, Any], timeout: float) -> dict[str, Any]:
        if not self._proc or not self._proc.stdin or not self._proc.stdin.writable():
            raise RuntimeError("engine process is not running")
        self._next_id += 1
        rid = self._next_id
        request = {**request, "id": rid}
        fut: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[rid] = fut
        try:
            self._proc.stdin.write((json.dumps(request) + "\n").encode())
            self._proc.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            self._pending.pop(rid, None)
            raise RuntimeError(f"engine pipe broken: {exc}") from exc
        return await asyncio.wait_for(fut, timeout=timeout)

    async def call(self, op: str, **payload: Any) -> dict[str, Any]:
        """Send one op; restart the child once if it died mid-call."""
        async with self._lock:
            if self._proc is None or self._proc.poll() is not None:
                await self._boot()
        try:
            return await self._roundtrip({"op": op, **payload}, REQUEST_TIMEOUT_S)
        except (RuntimeError, asyncio.TimeoutError):
            async with self._lock:
                if self._proc is not None and self._proc.poll() is not None:
                    await self._boot()
                else:  # hung child — replace it
                    await self.stop()
                    await self._boot()
            return await self._roundtrip({"op": op, **payload}, REQUEST_TIMEOUT_S)


bridge = EngineBridge()
