"""Engine API — headless execution of the registered scientific skills through
the SAME unified executor the browser runs (constitution §0.7: numbers only
come from real execution; here the executor runs in Node instead of a browser
worker, so the backend chain is fully playable without a UI).

Routes (prefix /api/engine):
  POST /execute              {skill, input, planId?, parentRunId?} → SkillOutcome
  GET  /skills               registry metadata (whitelist surface)
  GET  /runs                 recent ExperimentRuns recorded by the engine
  GET  /kakeya/precomputed   high-scale C++ precompute bundle (run records)

Large-scale policy (AGENTS §3.2): the browser computes small scales real-time;
runs too heavy for the page are precomputed offline by the C++ engine and
served here as immutable ExperimentRuns the page imports atomically.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from server.engine_bridge import bridge

router = APIRouter(prefix="/api/engine", tags=["engine"])

REPO_ROOT = Path(__file__).resolve().parent.parent
PRECOMPUTED_BUNDLE = REPO_ROOT / "src" / "data" / "kakeya-precomputed-runs.json"
MAX_INPUT_BYTES = 256 * 1024


class ExecuteRequest(BaseModel):
    skill: str = Field(min_length=1, max_length=64)
    input: dict[str, Any] = Field(default_factory=dict)
    planId: str | None = Field(default=None, max_length=200)
    parentRunId: str | None = Field(default=None, max_length=120)


def _bounded_request(model: ExecuteRequest) -> None:
    size = len(json.dumps(model.input, default=str).encode())
    if size > MAX_INPUT_BYTES:
        raise HTTPException(status_code=413, detail=f"engine input exceeds {MAX_INPUT_BYTES // 1024} KB limit")


_ONCE_BUNDLE = REPO_ROOT / "scripts" / "engine_once.mjs"


@router.post("/execute")
async def execute(req: ExecuteRequest) -> dict[str, Any]:
    _bounded_request(req)
    payload = json.dumps(req.input, ensure_ascii=False)
    if len(payload.encode()) > MAX_INPUT_BYTES:
        raise HTTPException(status_code=413, detail=f"engine input exceeds {MAX_INPUT_BYTES // 1024} KB limit")
    # serverless path (preferred when the once-bundle ships): a SHORT-LIVED
    # node process runs the skill entirely inside this HTTP call — immune to
    # FC instance freezing that starves the long-lived stdio engine
    if _ONCE_BUNDLE.exists():
        import asyncio

        proc = await asyncio.create_subprocess_exec(
            "node", str(_ONCE_BUNDLE), req.skill, payload, req.planId or "",
            *(["", req.parentRunId] if req.parentRunId else []),
            cwd=str(REPO_ROOT),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=180.0)
        except asyncio.TimeoutError:
            proc.kill()
            raise HTTPException(status_code=504, detail="inline engine execution timed out") from None
        if proc.returncode != 0:
            detail = stderr.decode("utf-8", "replace")[-400:] or f"exit {proc.returncode}"
            raise HTTPException(status_code=502, detail=f"inline engine failed: {detail}")
        try:
            parsed = json.loads(stdout.decode("utf-8"))
        except ValueError:
            raise HTTPException(status_code=502, detail="inline engine produced unparseable output") from None
        return parsed

    # stdio bridge fallback (long-lived engine for always-on deployments)
    try:
        resp = await bridge.call(
            "execute",
            skill=req.skill,
            input=req.input,
            planId=req.planId,
            parentRunId=req.parentRunId,
        )
    except TimeoutError:
        raise HTTPException(status_code=504, detail="engine execution timed out") from None
    if not resp.get("ok"):
        raise HTTPException(status_code=502, detail=f"engine error: {resp.get('error', 'unknown')}")
    return {"outcome": resp["outcome"]}


@router.get("/skills")
async def skills() -> dict[str, Any]:
    resp = await bridge.call("skills")
    if not resp.get("ok"):
        raise HTTPException(status_code=502, detail=f"engine error: {resp.get('error', 'unknown')}")
    return {"skills": resp["skills"]}


@router.get("/runs")
async def runs(limit: int = 50, kind: str | None = None) -> dict[str, Any]:
    if not 1 <= limit <= 500:
        raise HTTPException(status_code=422, detail="limit must be in [1, 500]")
    resp = await bridge.call("runs", limit=limit, kind=kind)
    if not resp.get("ok"):
        raise HTTPException(status_code=502, detail=f"engine error: {resp.get('error', 'unknown')}")
    return {"runs": resp["runs"]}


@router.get("/kakeya/precomputed")
async def kakeya_precomputed() -> dict[str, Any]:
    """High-scale runs from the C++ engine (kakeya-voxel-v3-cpp, FNV-1a sealed).
    The page imports this bundle atomically via experiment.import — datapoints
    then carry real runIds, not presentation literals."""
    try:
        text = PRECOMPUTED_BUNDLE.read_text()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="precomputed bundle not generated yet") from None
    bundle = json.loads(text)
    if isinstance(bundle, dict) and "runs" in bundle:
        meta = bundle.get("meta", {})
        runs = bundle["runs"]
    else:  # tolerate a bare array bundle
        meta = {}
        runs = bundle
    return {"meta": meta, "runs": runs}
