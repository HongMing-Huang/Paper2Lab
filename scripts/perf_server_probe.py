"""#34 server-side P50/P95 probe (headless): engine cold/warm execute, plan
registration, fork lineage, and ingest queue latency through the REAL app
(ASGI, once-runner path — the deployment shape). Render P95 needs a browser
in the deployment environment and is reported separately.

Run: server/.venv/bin/python scripts/perf_server_probe.py
"""
import asyncio
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from asgi_lifespan import LifespanManager  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from server.main import app  # noqa: E402

N = 20
PLAN = {"planId": "probe-formula", "skill": "formula.evaluate", "goal": "p95 probe", "metrics": [], "nonClaims": []}


def pct(samples: list[float], q: float) -> float:
    s = sorted(samples)
    return s[min(len(s) - 1, int(q * len(s)))]


async def main() -> None:
    data_dir = os.environ.setdefault("PAPER2LAB_DATA_DIR", "/tmp/p2l-p95-probe")
    async with LifespanManager(app) as mgr:
        async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t", timeout=120) as client:
            # cold execute (first engine spawn of the process)
            t0 = time.perf_counter()
            r = await client.post("/api/engine/execute", json={"skill": "formula.evaluate", "input": {"expression": ["Sin", "x"], "bindings": {"x": 1}}, "planId": PLAN["planId"], "plan": PLAN})
            cold = (time.perf_counter() - t0) * 1000
            assert r.status_code == 200 and r.json()["outcome"]["status"] == "ok"

            # warm executes
            lat: list[float] = []
            for i in range(N):
                t0 = time.perf_counter()
                r = await client.post("/api/engine/execute", json={"skill": "formula.evaluate", "input": {"expression": ["Add", "x", i], "bindings": {"x": i}}, "planId": PLAN["planId"], "plan": PLAN, "requestId": f"probe-{i}"})
                lat.append((time.perf_counter() - t0) * 1000)
                assert r.status_code == 200

            # requestId dedupe path (cache hit latency)
            dup: list[float] = []
            for _ in range(N):
                t0 = time.perf_counter()
                await client.post("/api/engine/execute", json={"skill": "formula.evaluate", "input": {"expression": ["Sin", "x"], "bindings": {"x": 1}}, "planId": PLAN["planId"], "plan": PLAN, "requestId": "probe-0"})
                dup.append((time.perf_counter() - t0) * 1000)

            # ingest queue latency (ok hook — process spawn per conversion)
            os.environ["PAPER2LAB_TEST_CONVERT"] = "ok"
            ing: list[float] = []
            for _ in range(6):
                t0 = time.perf_counter()
                resp = await client.post("/api/ingest", files={"file": ("p.pdf", b"%PDF-1.4\n%%EOF\n", "application/pdf")})
                job = resp.json()["jobId"]
                while True:
                    st = (await client.get(f"/api/ingest/{job}")).json()
                    if st["status"] in ("done", "error", "timeout"):
                        break
                    await asyncio.sleep(0.05)
                ing.append((time.perf_counter() - t0) * 1000)
                assert st["status"] == "done", st
            os.environ.pop("PAPER2LAB_TEST_CONVERT", None)

    print(f"engine cold execute (spawn included): {cold:.0f}ms")
    print(f"engine warm execute: p50 {pct(lat, 0.5):.1f}ms  p95 {pct(lat, 0.95):.1f}ms  (n={N})")
    print(f"requestId cache-hit retry:  p50 {pct(dup, 0.5):.1f}ms  p95 {pct(dup, 0.95):.1f}ms")
    print(f"ingest (isolated worker):   p50 {pct(ing, 0.5):.0f}ms  p95 {pct(ing, 0.95):.0f}ms  (n=6)")
    print("NOTE: parse(docling real) / model-init / render P95 belong to the deployment environment — see #34 checklist.")


asyncio.run(main())
