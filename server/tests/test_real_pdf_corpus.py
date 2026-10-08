"""#24 五 drift guard (real Docling; excluded from quick runs by the
`not real_docling` name filter, matching test_api.py): the committed acceptance fixtures under
src/ingest/fixtures are REAL parses of the tectonic papers in public/papers.
This test re-parses two of them (one ODE, one fit) through the actual
pipeline and asserts the semantics the router depends on still extract
identically: \\dot-formulas, prose initials, and the structured table rows.
Marked real_docling — excluded from the quick set, run in the full job."""
import asyncio
import json
import time
from pathlib import Path

import httpx
import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from server.main import app

PAPERS = Path(__file__).parent.parent.parent / "public" / "papers"
FIXTURES = Path(__file__).parent.parent.parent / "src" / "ingest" / "fixtures"

CASES = [
    ("ode-lotka-volterra.pdf", "ode-lotka-volterra.docling.json"),
    ("fit-exponential-decay.pdf", "fit-exponential-decay.docling.json"),
]


async def _parse(client: AsyncClient, pdf: Path) -> dict:
    r = await client.post("/api/ingest", files={"file": (pdf.name, pdf.read_bytes(), "application/pdf")})
    assert r.status_code == 202, r.text
    job_id = r.json()["jobId"]
    deadline = time.time() + 600
    while time.time() < deadline:
        body = (await client.get(f"/api/ingest/{job_id}")).json()
        if body["status"] in ("done", "error", "timeout"):
            break
        await asyncio.sleep(2)
    assert body["status"] == "done", body
    return body["document"]


@pytest.mark.asyncio
async def test_real_docling_corpus_fixture_drift():
    async with LifespanManager(app) as mgr:
        async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t", timeout=600) as client:
            for pdf_name, fixture_name in CASES:
                doc = await _parse(client, PAPERS / pdf_name)
                fixed = json.loads((FIXTURES / fixture_name).read_text())

                formulas = [i.get("latex") for i in doc["items"] if i["kind"] == "formula"]
                fixed_formulas = [i.get("latex") for i in fixed["items"] if i["kind"] == "formula"]
                assert formulas == fixed_formulas, f"{pdf_name}: formula extraction drifted"

                text = "\n".join(i.get("text") or "" for i in doc["items"])
                if "lotka" in pdf_name:
                    assert "x(0) = 2" in text and "y(0) = 0.5" in text

                tables = [i for i in doc["items"] if i["kind"] == "table"]
                if "fit-" in pdf_name:
                    assert len(tables) == 1
                    rows = tables[0].get("table", {}).get("rows")
                    numeric = [r for r in rows if len(r) >= 2 and _is_num(r[0]) and _is_num(r[1])]
                    assert len(numeric) == 5, f"{pdf_name}: table rows drifted: {rows}"


def _is_num(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False
