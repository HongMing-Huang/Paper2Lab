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
REQUEST_TIMEOUT_S = float(os.environ.get("PAPER2LAB_ENGINE_TIMEOUT", "120"))
# cold boot on weak/shared CPUs (tsx transpile + wasm instantiate) can take
# minutes — configurable, and long by default, so the first call never fails
BOOT_TIMEOUT_S = float(os.environ.get("PAPER2LAB_ENGINE_BOOT_TIMEOUT", "180"))

class EngineBridge:
    def __init__(self) -> None:
        self._proc: subprocess.Popen[bytes] | None = None
        self._lock: asyncio.Lock | None = None
        self._lock_loop: asyncio.AbstractEventLoop | None = None
        self._boot_loop: asyncio.AbstractEventLoop | None = None
        self._next_id = 0
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._reader: asyncio.Task[None] | None = None
        self._drain: asyncio.Task[None] | None = None
        self._last_error: str | None = None
        self._started_at: float | None = None

    def _loop_changed(self) -> bool:
        """the child + reader/drain tasks are bound to the loop they booted
        on (futures resolve there). pytest-asyncio gives every test a NEW
        loop: reusing the old child cross-loop leaves pings unanswered
        (reproduced: 180s boot timeouts after the first test). Such a child
        must be torn down and rebooted on the CURRENT loop."""
        return self._proc is not None and self._boot_loop is not asyncio.get_running_loop()

    def _guard(self) -> asyncio.Lock:
        """a module-level Lock binds to its FIRST event loop forever — under
        pytest each test gets a new loop and the old (possibly still held,
        dead-loop) lock would raise. Rebuild the lock when the running loop
        changed; sequential owners keep mutual exclusion."""
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock = asyncio.Lock()
            self._lock_loop = loop
        return self._lock

    # ------------------------------------------------------------ lifecycle
    async def _boot(self) -> None:
        # 云端诊断：spawn 前后各打一行到 stdout（平台收进 run 日志）；
        # stderr 由 drain 任务捕获，boot 失败时随异常带出。
        use_bundle = (REPO_ROOT / "scripts" / "engine_server.bundle.mjs").exists()
        cmd = ["node", "scripts/engine_server.bundle.mjs"] if use_bundle else [
            "node", "--import", "tsx", "scripts/engine_server.ts"]
        print(f"[engine-boot] spawning {' '.join(cmd)} (cwd={REPO_ROOT})", flush=True)
        env = dict(os.environ)
        env.setdefault("NODE_NO_WARNINGS", "1")
        self._proc = subprocess.Popen(
            cmd,
            cwd=REPO_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            shell=False,
        )
        print(f"[engine-boot] spawned pid={self._proc.pid}", flush=True)
        self._boot_loop = asyncio.get_running_loop()
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
        # wait for the engine-ready banner (or first response) before serving;
        # a boot failure must surface the child's stderr tail in the logs
        deadline = time.monotonic() + BOOT_TIMEOUT_S
        last: dict[str, Any] = {}
        while time.monotonic() < deadline:
            last = await self._roundtrip({"op": "ping"}, timeout=BOOT_TIMEOUT_S)
            if last.get("ok"):
                return
        self._teardown_proc()
        raise RuntimeError(
            f"engine did not become ready in {BOOT_TIMEOUT_S}s "
            f"(stderr tail: {self._last_error or 'none'})"
        )

    async def start(self) -> None:
        async with self._guard():
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

    def _teardown_proc(self) -> None:
        """drop the child reference WITHOUT waiting (boot-failure path — the
        process may be mid-startup; the next call reboots a fresh one)"""
        self._proc = None
        for task in (self._reader, self._drain):
            if task:
                task.cancel()
        self._reader = None
        self._drain = None

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
        """Send one op. Serverless (FC) freezes the instance ~130s after the
        last request; the child process survives as a ZOMBIE that poll()==0
        misses (process alive, never answers). So: quick-probe any existing
        child with a 3s ping — zombie → teardown → fresh boot (the prebuilt
        bundle boots in <1s, well inside the platform's 120s gateway window).
        """
        async with self._guard():
            if self._loop_changed():
                # child belongs to a dead loop — its futures can never resolve
                # here; replace it instead of timing out on the zombie probe
                await self.stop()
            if self._proc is not None and self._proc.poll() is None:
                try:
                    probe = await self._roundtrip({"op": "ping"}, timeout=3.0)
                    if not probe.get("ok"):
                        raise RuntimeError("ping rejected")
                except Exception:
                    await self.stop()
            if self._proc is None or self._proc.poll() is not None:
                await self._boot()
        try:
            return await self._roundtrip({"op": op, **payload}, REQUEST_TIMEOUT_S)
        except (RuntimeError, asyncio.TimeoutError):
            async with self._guard():
                if self._proc is not None and self._proc.poll() is not None:
                    await self._boot()
                else:  # hung child — replace it
                    await self.stop()
                    await self._boot()
            return await self._roundtrip({"op": op, **payload}, REQUEST_TIMEOUT_S)


bridge = EngineBridge()
