"""Backend acceptance tests (Stage C/D) — process-internal HTTP via
httpx ASGI transport, real Docling on a real PDF, no GUI.

Run:  server/.venv/bin/python -m pytest server/tests -x -q
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import uuid as _uuid
_RUN = _uuid.uuid4().hex[:6]  # unique session suffix per test run

# isolated data dir per test session (restart-recovery tests remount it)
_DATA_DIR = Path(tempfile.mkdtemp(prefix="p2l-test-data-"))
os.environ["PAPER2LAB_DATA_DIR"] = str(_DATA_DIR)
# no DASHSCOPE key in tests → deterministic SOP backend (documented mode)
os.environ.pop("DASHSCOPE_API_KEY", None)

from asgi_lifespan import LifespanManager  # noqa: E402

from server.main import app  # noqa: E402

SAMPLE_PDF = ROOT / "public" / "papers" / "sample-harmonic.pdf"


async def _client() -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def sse_events(text: str) -> list[dict]:
    out = []
    for line in text.splitlines():
        if line.startswith("data: "):
            try:
                out.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass
    return out


# ---------------------------------------------------------------- liveness


@pytest.mark.asyncio
async def test_health_is_alive_and_ready_checks_dependencies():
    async with await _client() as c:
        r = await c.get("/api/health")
        assert r.status_code == 200
        assert r.json() == {"ok": True}

        r = await c.get("/api/ready")
        assert r.status_code == 200
        body = r.json()
        assert body["ready"] is True
        assert body["checks"]["docling"]["ok"] is True
        assert body["checks"]["agent"]["backend"] == "sop-deterministic"
        assert body["checks"]["storage"]["ok"] is True


# ---------------------------------------------------------------- upload gates


@pytest.mark.asyncio
async def test_rejects_non_pdf_and_corrupt_pdf():
    async with await _client() as c:
        r = await c.post(
            "/api/ingest",
            files={"file": ("notes.txt", b"hello", "text/plain")},
        )
        assert r.status_code == 415

        r = await c.post(
            "/api/ingest",
            files={"file": ("broken.pdf", b"not a pdf at all", "application/pdf")},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_unknown_job_and_document_are_404():
    async with await _client() as c:
        assert (await c.get("/api/ingest/job-nope")).status_code == 404
        assert (await c.get("/api/document/doc-nope")).status_code == 404


# ---------------------------------------------------------------- real ingest


@pytest.mark.asyncio
async def test_real_docling_ingest_full_lifecycle():
    """Valid PDF → async job → real Docling parse → document query.

    Verifies formulas keep page/bbox and that the SECOND page's items carry
    page=2 (multi-page provenance), plus table/figure structure retention.
    """
    payload = SAMPLE_PDF.read_bytes()
    async with await _client() as c:
        r = await c.post("/api/ingest", files={"file": ("sample-harmonic.pdf", payload, "application/pdf")})
        assert r.status_code == 202
        job_id = r.json()["jobId"]

        deadline = time.time() + 600
        final = None
        while time.time() < deadline:
            s = await c.get(f"/api/ingest/{job_id}")
            assert s.status_code == 200
            body = s.json()
            assert body["status"] in ("running", "done", "error")
            if body["status"] in ("done", "error"):
                final = body
                break
            await asyncio.sleep(2)
        assert final is not None and final["status"] == "done", final
        doc = final["document"]
        assert doc["engine"] == "docling"
        assert doc["doclingVersion"]
        assert len(doc["pages"]) == 2

        formulas = [i for i in doc["items"] if i["kind"] == "formula"]
        assert len(formulas) >= 2
        for f in formulas:
            assert f["page"] == 1  # both display equations live on page 1
            assert f["latex"]
            assert 0 <= f["bbox"]["x"] <= 1 and 0 <= f["bbox"]["y"] <= 1

        # page-2 provenance: the sampled trace figure + its caption are on p.2
        page2 = [i for i in doc["items"] if i["page"] == 2]
        assert page2, "second page items must keep page=2"
        assert all(i["page"] == 2 for i in page2)
        assert any(i["kind"] == "figure" for i in page2)

        # tables never arrive as empty labels: they carry structure or an error
        for i in doc["items"]:
            if i["kind"] == "table":
                assert ("table" in i and i["table"]["columns"]) or i.get("tableError")

        # document query endpoint returns the same persisted doc
        r2 = await c.get(f"/api/document/{doc['docId']}")
        assert r2.status_code == 200
        assert r2.json()["docId"] == doc["docId"]


# ---------------------------------------------------------------- agent SOP


@pytest.mark.asyncio
async def test_agent_turn_plan_then_require_execution_then_done():
    async with await _client() as c:
        r = await c.post(
            "/api/agent/turn",
            json={
                "sessionId": "pytest-1-" + _RUN,
                "intent": "如果 a 增大一倍会怎样？",
                "context": {"deskKind": "formula", "params": ["a", "b"]},
            },
        )
        assert r.status_code == 200
        events = sse_events(r.text)
        kinds = [e["type"] for e in events]
        assert "plan_created" in kinds
        assert "require_execution" in kinds
        plan = next(e for e in events if e["type"] == "plan_created")["plan"]
        assert plan["skill"] == "formula.plot"
        assert plan["nonClaims"]

        req = next(e for e in events if e["type"] == "require_execution")
        assert req["tool"] == "scientific_execute"
        assert req["args"]["steps"][0]["op"] == "experiment.fork"

        # browser (test double at the transport level ONLY — numbers below are
        # what a real client computed) replies with the batch
        resume = {
            "roundId": req.get("roundId"),
            "replyId": req.get("replyId", ""),
            "executionResults": [
                {
                    "toolCallId": req["toolCallId"],
                    "tool": "scientific_execute",
                    "status": "ok",
                    "result": {
                        "runs": [
                            {"runId": "formula-curve-xyz", "metrics": {"peak": 6.0, "integral": 50.95}, "durationMs": 0}
                        ],
                        "comparison": {"runA": "r-base", "runB": "formula-curve-xyz", "rows": []},
                    },
                }
            ],
        }
        r2 = await c.post(
            "/api/agent/turn",
            json={"sessionId": "pytest-1-" + _RUN, "intent": "", "context": {}, "resume": resume},
        )
        events2 = sse_events(r2.text)
        kinds2 = [e["type"] for e in events2]
        assert "experiment_completed" in kinds2
        assert "comparison_created" in kinds2
        assert "observation_ready" in kinds2
        assert kinds2[-1] == "done"


@pytest.mark.asyncio
async def test_duplicate_resume_is_rejected():
    async with await _client() as c:
        async def first_round(session: str) -> dict:
            r = await c.post(
                "/api/agent/turn",
                json={"sessionId": session, "intent": "把 a 设为 3", "context": {"deskKind": "formula", "params": ["a"]}},
            )
            return next(e for e in sse_events(r.text) if e["type"] == "require_execution")

        req = await first_round("pytest-dup-" + _RUN)
        resume = {
            "roundId": req.get("roundId"),
            "executionResults": [{"toolCallId": req["toolCallId"], "tool": "scientific_execute", "status": "ok", "result": {"runs": []}}],
        }
        r1 = await c.post("/api/agent/turn", json={"sessionId": "pytest-dup-" + _RUN, "intent": "", "context": {}, "resume": resume})
        assert "done" in [e["type"] for e in sse_events(r1.text)]
        # replaying the SAME resume must be rejected, not re-executed
        r2 = await c.post("/api/agent/turn", json={"sessionId": "pytest-dup-" + _RUN, "intent": "", "context": {}, "resume": resume})
        kinds = [e["type"] for e in sse_events(r2.text)]
        assert "error" in kinds
        assert "done" not in kinds


@pytest.mark.asyncio
async def test_failed_execution_reports_failure_not_success():
    async with await _client() as c:
        r = await c.post(
            "/api/agent/turn",
            json={"sessionId": "pytest-fail-" + _RUN, "intent": "a 增大一倍", "context": {"deskKind": "formula", "params": ["a"]}},
        )
        req = next(e for e in sse_events(r.text) if e["type"] == "require_execution")
        r2 = await c.post(
            "/api/agent/turn",
            json={
                "sessionId": "pytest-fail-" + _RUN,
                "intent": "",
                "context": {},
                "resume": {
                    "roundId": req.get("roundId"),
                    "executionResults": [
                        {"toolCallId": req["toolCallId"], "tool": "scientific_execute", "status": "error", "error": "compile failed"}
                    ]
                },
            },
        )
        kinds = [e["type"] for e in sse_events(r2.text)]
        assert "experiment_failed" in kinds
        assert "comparison_created" not in kinds
        assert "observation_ready" not in kinds
        done = next(e for e in sse_events(r2.text) if e["type"] == "done")
        assert done["reason"] == "execution_failed"


@pytest.mark.asyncio
async def test_round_limit_blocks_unbounded_loops():
    async with await _client() as c:
        session = "pytest-rounds"
        for i in range(6):
            r = await c.post(
                "/api/agent/turn",
                json={"sessionId": session, "intent": "b 增大一倍", "context": {"deskKind": "formula", "params": ["b"]}},
            )
            kinds = [e["type"] for e in sse_events(r.text)]
            if i >= 5:
                assert "error" in kinds  # round limit tripped
            else:
                assert "require_execution" in kinds


@pytest.mark.asyncio
async def test_resume_without_results_is_rejected():
    async with await _client() as c:
        r = await c.post(
            "/api/agent/turn",
            json={"sessionId": "pytest-bad-" + _RUN, "intent": "a 设为 2", "context": {"deskKind": "formula", "params": ["a"]}},
        )
        req = next(e for e in sse_events(r.text) if e["type"] == "require_execution")
        r2 = await c.post(
            "/api/agent/turn",
            json={"sessionId": "pytest-bad-" + _RUN, "intent": "", "context": {}, "resume": {"executionResults": []}},
        )
        assert "error" in [e["type"] for e in sse_events(r2.text)]
