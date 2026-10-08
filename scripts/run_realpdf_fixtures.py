#!/usr/bin/env python3
"""Regenerate the REAL-PDF acceptance fixtures (#24 五): upload the four
tectonic papers to the running local backend (real Docling), then dump each
normalized document to src/ingest/fixtures/<name>.docling.json — the same
"real dump committed" pattern as sample-harmonic. Requires:
  PAPER2LAB_DATA_DIR=<scratch> server/.venv/bin/uvicorn server.main:app --port 8790
"""
import asyncio
import json
import pathlib
import sys

import httpx

BASE = "http://127.0.0.1:8790"
PAPERS = [
    "ode-lotka-volterra.pdf",
    "ode-damped-oscillator.pdf",
    "fit-exponential-decay.pdf",
    "fit-sine-fit.pdf",
]
FIXTURES = pathlib.Path(__file__).parent.parent / "src" / "ingest" / "fixtures"


async def main() -> int:
    rc = 0
    async with httpx.AsyncClient(base_url=BASE, timeout=600) as c:
        for name in PAPERS:
            pdf = (pathlib.Path(__file__).parent.parent / "public" / "papers" / name).read_bytes()
            r = await c.post("/api/ingest", files={"file": (name, pdf, "application/pdf")})
            if r.status_code != 202:
                print(f"FAIL {name}: HTTP {r.status_code} {r.text[:200]}", file=sys.stderr)
                rc = 1
                continue
            job = r.json()["jobId"]
            doc = None
            for _ in range(300):
                await asyncio.sleep(2)
                st = (await c.get(f"/api/ingest/{job}")).json()
                if st["status"] in ("done", "error", "timeout"):
                    break
            if st["status"] != "done":
                print(f"FAIL {name}: {st['status']} {st.get('error', '')[:200]}", file=sys.stderr)
                rc = 1
                continue
            doc = st["document"]
            kinds = {}
            for item in doc.get("items", []):
                kinds[item["kind"]] = kinds.get(item["kind"], 0) + 1
            out = FIXTURES / f"{name.removesuffix('.pdf')}.docling.json"
            out.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
            print(f"parsed {name}: {len(doc.get('items', []))} items {kinds} -> {out.name}")
    return rc


raise SystemExit(asyncio.run(main()))
