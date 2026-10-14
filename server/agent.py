"""Research Orchestrator (AGENTS.md v6 §4) — the single 0.1 agent.

Transport: FastAPI SSE endpoints exposing a normalized event stream
(plan_created / tool_started / require_execution / experiment_completed /
comparison_created / observation_ready / done / error). The browser contract
lives in src/desk/agentBridge.ts — keep both in sync.

Two interchangeable backends behind one protocol:
- AgentScope backend: AgentScope 2.x ``Agent`` (ReAct) whose scientific/canvas
  tools are EXTERNAL tools (``is_external_tool=True``). The agent parks on
  RequireExternalExecutionEvent; we forward the tool call to the browser (the
  real Scientific Runtime: Cortex / kakeya worker), then resume with
  ExternalExecutionResultEvent. The LLM therefore cannot fabricate CALCULATED
  numbers — it only quotes run ids the browser produced. Enabled when
  DASHSCOPE_API_KEY is present (model via PAPER2LAB_AGENT_MODEL).
- SOP backend: deterministic fallback with the same event protocol and the
  same external-execution handoff, so the product runs offline.

Sessions are held server-side (one Agent / SOP history per sessionId).
"""
from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from server.agent_provider import (
    ai_verified,
    build_model,
    probe_capabilities,
    resolve_provider,
)

router = APIRouter(prefix="/api/agent")

_NUM = r"(-?\d+(?:\.\d+)?)"


def _env(name: str) -> str | None:
    return os.environ.get(name) or None


def backend_name() -> str:
    return resolve_provider().backend


def ev(type_: str, **payload: Any) -> dict:
    return {"type": type_, **payload}


# --------------------------------------------------------------------------
# deterministic SOP backend (fallback; mirrors src/skills/formulaPlan.ts)
# --------------------------------------------------------------------------


@dataclass
class SopSession:
    id: str
    history: list[dict] = field(default_factory=list)
    """tool calls already answered once — duplicate resumes are rejected"""
    answered_calls: set[str] = field(default_factory=set)
    """toolCallIds this session actually issued via require_execution — resumes
    carrying any other id (never issued / forged) are rejected"""
    issued_calls: set[str] = field(default_factory=set)
    """how many external-execution rounds this session has consumed"""
    rounds: int = 0
    """Lane B round token: the nonce of the round currently awaiting a resume.
    A resume must carry it — stale/replayed rounds from an earlier turn are
    rejected, and it survives restarts via _persist_session."""
    current_round: str | None = None
    """calls issued in the CURRENT round (batch completeness check: a resume
    must answer exactly these, no partials, no extras from other rounds)"""
    round_calls: set[str] = field(default_factory=set)


_sop_sessions: dict[str, SopSession] = {}

MAX_ROUNDS = 5
ALLOWED_TOOLS = ("scientific_execute", "canvas_apply")

# server-execution rounds per agent turn (runaway tool loops abort loudly —
# reproduced with a real model retrying failing steps ~40 times)
_MAX_AGENT_SERVER_ROUNDS = int(os.environ.get("PAPER2LAB_AGENT_MAX_ROUNDS", "6"))

# ---- session persistence (restart recovery) ----------------------------------
# Sessions live in the same DATA_DIR as ingest jobs; a server restart reloads
# them so answered/issued toolCallIds stay enforced across restarts.


def _data_dir() -> Path:
    return Path(os.environ.get("PAPER2LAB_DATA_DIR", Path(__file__).parent / "data"))


def _session_path(session_id: str) -> Path:
    # session ids are opaque strings — keep them out of path components
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", session_id)[:80]
    return _data_dir() / f"agent-session-{safe}.json"


def _persist_session(session: SopSession) -> None:
    try:
        _data_dir().mkdir(parents=True, exist_ok=True)
        _session_path(session.id).write_text(
            json.dumps(
                {
                    "id": session.id,
                    "history": session.history,
                    "answered_calls": sorted(session.answered_calls),
                    "issued_calls": sorted(session.issued_calls),
                    "rounds": session.rounds,
                    "current_round": session.current_round,
                    "round_calls": sorted(session.round_calls),
                },
                ensure_ascii=False,
            )
        )
    except OSError:
        # persistence is best-effort: an unwritable disk must not kill turns,
        # but /api/ready's storage check will already flag it
        pass


def _load_sessions() -> None:
    try:
        for path in _data_dir().glob("agent-session-*.json"):
            data = json.loads(path.read_text())
            if not isinstance(data, dict) or "id" not in data:
                continue
            s = SopSession(
                id=str(data["id"]),
                history=list(data.get("history", [])),
                answered_calls=set(data.get("answered_calls", [])),
                issued_calls=set(data.get("issued_calls", [])),
                rounds=int(data.get("rounds", 0)),
                current_round=data.get("current_round"),
                round_calls=set(data.get("round_calls", [])),
            )
            _sop_sessions[s.id] = s
    except (OSError, ValueError):
        pass


_load_sessions()


def _parse_formula_intent(q: str, params: list[str]) -> list[dict] | None:
    if not params:
        return None
    target = next((p for p in params if re.search(rf"\b{p}\b", q)), params[0])

    m = re.search(rf"(设为|改为|置为|调整为|set(?:\s+to)?)\s*{_NUM}", q)
    if m:
        return [
            {"op": "experiment.fork"},
            {"op": "formula.set", "param": target, "value": float(m.group(2))},
            {"op": "formula.plot"},
            {"op": "experiment.compare"},
        ]
    if re.search(r"(增大|增加|放大|加倍|翻倍)(一倍|1倍|两倍|2倍)?|double", q):
        return [
            {"op": "experiment.fork"},
            {"op": "formula.scale", "param": target, "value": 2.0},
            {"op": "formula.plot"},
            {"op": "experiment.compare"},
        ]
    if re.search(r"(减少一半|减半|减到一半|缩小一半|halve)", q):
        return [
            {"op": "experiment.fork"},
            {"op": "formula.scale", "param": target, "value": 0.5},
            {"op": "formula.plot"},
            {"op": "experiment.compare"},
        ]
    if re.search(r"(对比|比较|compare)", q):
        return [{"op": "experiment.compare"}]
    return None


def _parse_kakeya_intent(q: str) -> list[dict] | None:
    if re.search(r"(方向|方向数|direction|N)", q, re.I) and re.search(r"(减半|一半|halve)", q, re.I):
        return [
            {"op": "experiment.fork"},
            {"op": "kakeya.halve-n"},
            {"op": "kakeya.measure"},
            {"op": "experiment.compare"},
        ]
    if re.search(r"(集中|更聚|packing|提高聚集)", q, re.I):
        return [
            {"op": "experiment.fork"},
            {"op": "kakeya.set", "param": "packing", "value": 0.85},
            {"op": "kakeya.measure"},
            {"op": "experiment.compare"},
        ]
    if re.search(r"(sweep|扫描|随\s*N|增长)", q, re.I):
        return [{"op": "kakeya.sweep"}, {"op": "experiment.compare"}]
    return None


def _parse_ode_intent(q: str, params: list[str]) -> list[dict] | None:
    """math-model desk: Lotka–Volterra parameter tasks (same op vocabulary
    shape as the formula desk, executed via the ode.solve kernel)."""
    if not params:
        return None
    target = next((p for p in params if re.search(rf"\b{p}\b", q)), params[0])
    m = re.search(rf"(设为|改为|置为|调整为|set(?:\s+to)?)\s*{_NUM}", q)
    if m:
        return [
            {"op": "experiment.fork"},
            {"op": "ode.set", "param": target, "value": float(m.group(2))},
            {"op": "ode.solve"},
            {"op": "experiment.compare"},
        ]
    if re.search(rf"(增大|增加|放大|加倍|翻倍)(一倍|1倍|两倍|2倍)?|double\s+{target}", q):
        return [
            {"op": "experiment.fork"},
            {"op": "ode.scale", "param": target, "value": 2.0},
            {"op": "ode.solve"},
            {"op": "experiment.compare"},
        ]
    if re.search(rf"(减少一半|减半|减到一半|缩小一半|halve\s+{target})", q):
        return [
            {"op": "experiment.fork"},
            {"op": "ode.scale", "param": target, "value": 0.5},
            {"op": "ode.solve"},
            {"op": "experiment.compare"},
        ]
    if re.search(r"(对比|比较|compare)", q):
        return [{"op": "experiment.compare"}]
    return None


def _parse_geometry_intent(q: str) -> list[dict] | None:
    """geometry desk: Perron-tree tasks over k (subdivision) and α (overlap)."""
    m_alpha = re.search(rf"(?:α|alpha|重叠比).{{0,6}}?(设为|改为|置为|调整为)\s*{_NUM}", q)
    if m_alpha:
        return [
            {"op": "experiment.fork"},
            {"op": "geometry.set", "param": "alpha", "value": float(m_alpha.group(2))},
            {"op": "geometry.plot"},
            {"op": "experiment.compare"},
        ]
    m_k = re.search(rf"(?:k|细分|层数).{{0,8}}?(设为|改为|置为|调整为)\s*{_NUM}", q)
    if m_k:
        return [
            {"op": "experiment.fork"},
            {"op": "geometry.set", "param": "k", "value": float(m_k.group(2))},
            {"op": "geometry.plot"},
            {"op": "experiment.compare"},
        ]
    if re.search(r"(α|alpha|重叠).{0,8}(加倍|翻倍|增大)", q):
        return [
            {"op": "experiment.fork"},
            {"op": "geometry.scale", "param": "alpha", "value": 1.2},
            {"op": "geometry.plot"},
            {"op": "experiment.compare"},
        ]
    if re.search(r"(k|细分|层数).{0,8}(加倍|翻倍|增大)", q):
        return [
            {"op": "experiment.fork"},
            {"op": "geometry.scale", "param": "k", "value": 2.0},
            {"op": "geometry.plot"},
            {"op": "experiment.compare"},
        ]
    if re.search(r"(对比|比较|compare)", q):
        return [{"op": "experiment.compare"}]
    return None


def _parse_mujoco_intent(q: str, params: list[str]) -> list[dict] | None:
    """physics desk: MuJoCo model-level parameters (gravity/wind/timestep)."""
    if not params:
        params = ["gravityZ", "windX", "timestep"]
    target = next((p for p in params if re.search(rf"\b{p}\b", q)), None)
    if target is None and re.search(r"重力|gravity", q, re.I):
        target = "gravityZ"
    if target is None and re.search(r"风|wind", q, re.I):
        target = "windX"
    if target is None:
        return None
    m = re.search(rf"(设为|改为|置为|调整为|set(?:\s+to)?)\s*{_NUM}", q)
    if m:
        return [
            {"op": "experiment.fork"},
            {"op": "mujoco.set", "param": target, "value": float(m.group(2))},
            {"op": "mujoco.simulate"},
            {"op": "experiment.compare"},
        ]
    if re.search(rf"(增大|增加|放大|加倍|翻倍)(一倍|1倍|两倍|2倍)?|double\s+{target}", q):
        scale = -2.0 if target == "gravityZ" else 2.0  # gravity doubles DOWNWARD (−g)
        return [
            {"op": "experiment.fork"},
            {"op": "mujoco.scale", "param": target, "value": scale},
            {"op": "mujoco.simulate"},
            {"op": "experiment.compare"},
        ]
    if re.search(rf"(减少一半|减半|减到一半|缩小一半|halve\s+{target})", q):
        scale = 0.5 if target != "gravityZ" else -0.5
        return [
            {"op": "experiment.fork"},
            {"op": "mujoco.scale", "param": target, "value": scale},
            {"op": "mujoco.simulate"},
            {"op": "experiment.compare"},
        ]
    if re.search(r"(对比|比较|compare)", q):
        return [{"op": "experiment.compare"}]
    return None


def _parse_challenge_intent(q: str) -> list[dict] | None:
    """challenge desk: collect EVERY named parameter, then attempt once."""
    steps: list[dict] = []
    for name, words in [
        ("angleDeg", ["角度", "angle"]),
        ("speed", ["力度", "速度", "speed"]),
        ("length", ["杆长", "摆长", "length"]),
    ]:
        for w in words:
            m = re.search(rf"{w}.{{0,6}}?(设为|改为|置为|调整为)\s*{_NUM}", q)
            if m:
                steps.append({"op": "challenge.set", "param": name, "value": float(m.group(2))})
                break
    if re.search(r"试一次|再试|重试|attempt|try", q, re.I) or steps:
        steps.append({"op": "challenge.attempt"})
        return steps
    return None


def sop_plan(intent: str, context: dict) -> dict | None:
    desk = context.get("deskKind", "formula")
    if desk == "kakeya":
        steps = _parse_kakeya_intent(intent)
    elif desk == "ode":
        steps = _parse_ode_intent(intent, list(context.get("params", ["alpha", "beta", "gamma", "delta"])))
    elif desk == "geometry":
        steps = _parse_geometry_intent(intent)
    elif desk == "mujoco":
        steps = _parse_mujoco_intent(intent, list(context.get("params", [])))
    elif desk == "challenge":
        steps = _parse_challenge_intent(intent)
    else:
        steps = _parse_formula_intent(intent, list(context.get("params", [])))
    if not steps:
        return None
    meta = {
        "kakeya": ("kakeya.measure", "ts-kakeya-worker@v3", "r3f", ["unionVolume", "multiplicity"]),
        "ode": ("ode.solve", "ts-rk4@ode-rk4-0.1", "plot", ["finalPrey", "finalPredator", "conservedDrift"]),
        "geometry": ("geometry.2d", "perron-kernel@0.1", "svg", ["computedArea", "boundArea"]),
        "mujoco": ("mujoco.simulate", "mujoco-wasm@3.12.0", "r3f", ["finalTime", "qposNormFinal", "comZFinal"]),
        "challenge": ("challenge.attempt", "challenge-kernel@0.1", "r3f", ["score", "error", "hit"]),
    }.get(desk, ("formula.plot", "cortex-ce@0.142.0", "jsxgraph", ["curve", "peak", "integral"]))
    return {
        "planId": f"plan-{uuid.uuid4().hex[:8]}",
        "goal": f"用真实实验回答：「{intent[:60]}」",
        "skill": meta[0],
        "skillVersion": meta[1],
        "renderer": meta[2],
        "metrics": meta[3],
        "steps": steps,
        "evidenceBasis": (
            "后端引擎（与浏览器同一统一执行器）产生的 ExperimentRun"
            if context.get("execution") == "server"
            else "浏览器 Scientific Runtime（与用户完全相同的引擎）产生的 ExperimentRun"
        ),
        "nonClaims": ["不得声称证明了任何定理（有限尺度数值实验）"],
    }


async def sop_turn(session: SopSession, intent: str, context: dict) -> AsyncGenerator[dict, None]:
    plan = sop_plan(intent, context)
    if plan is None:
        yield ev("done", reason="not-an-experiment")
        return
    yield ev("plan_created", plan=plan)
    call_id = f"tc-{uuid.uuid4().hex[:10]}"
    session.issued_calls.add(call_id)
    # Lane B round token: this resume round is identified by a nonce the
    # browser must echo back — replayed/stale rounds are rejected
    session.current_round = f"round-{uuid.uuid4().hex[:8]}"
    session.round_calls = {call_id}
    # persist BEFORE yielding: if the server dies after the event reaches the
    # browser, the reloaded session must still accept this call's result
    _persist_session(session)
    yield ev(
        "require_execution",
        toolCallId=call_id,
        replyId="",
        tool="scientific_execute",
        roundId=session.current_round,
        args={"deskKind": context.get("deskKind", "formula"), "steps": plan["steps"]},
    )


async def sop_turn_server(session: SopSession, intent: str, context: dict) -> AsyncGenerator[dict, None]:
    """Server-execution mode: instead of pausing for the browser, the engine
    bridge runs the plan steps through the SAME unified executor — the turn
    completes headless (formula / kakeya / ode / geometry / mujoco desks)."""
    desk = str(context.get("deskKind", "formula"))
    base = context.get("base")
    base_run_id = context.get("baseRunId")
    # Lane B chaining: a follow-up turn may name the PREVIOUS target run —
    # the engine resolves its replayable input, so consecutive turns operate
    # on the LATEST run instead of silently re-forking the first one
    if base_run_id:
        from server.engine_bridge import bridge

        try:
            resolved = await bridge.call("run_input", runId=str(base_run_id))
        except TimeoutError:
            resolved = {"ok": False, "error": "engine timed out"}
        if not resolved.get("ok"):
            yield ev("error", message=f"baseRunId cannot be resolved: {resolved.get('error', 'unknown')}")
            yield ev("done", reason="execution_failed")
            return
        base = resolved.get("input")
        if str(resolved.get("skill", "")).startswith("kakeya") and desk == "formula":
            desk = "kakeya"  # the run's kind decides the desk, not the stale context
    if not isinstance(base, dict) or not base:
        yield ev("error", message="server execution mode requires context.base or a resolvable context.baseRunId")
        yield ev("done", reason="execution_failed")
        return
    plan = sop_plan(intent, context)
    if plan is None:
        yield ev("done", reason="not-an-experiment")
        return
    yield ev("plan_created", plan=plan)
    call_id = f"tc-{uuid.uuid4().hex[:10]}"
    session.issued_calls.add(call_id)
    session.history.append({"issued": call_id, "mode": "server", "intent": intent[:200]})
    _persist_session(session)
    yield ev("tool_started", toolCallId=call_id, tool="scientific_execute", mode="server")
    from server.engine_bridge import bridge

    try:
        resp = await bridge.call(
            "agent_steps",
            deskKind=desk,
            steps=plan["steps"],
            base=base,
            planId=plan["planId"],
            plan=plan,  # #32: the FULL contract registers in the engine — a bare planId proves nothing
        )
    except TimeoutError:
        resp = {"ok": False, "error": "engine timed out"}
    if not resp.get("ok"):
        session.history.append({"failed": [call_id]})
        _persist_session(session)
        yield ev(
            "experiment_failed",
            toolCallId=call_id,
            error=str(resp.get("error", "engine execution failed")),
        )
        yield ev("done", reason="execution_failed")
        return
    result = resp.get("result", {})
    session.history.append({"answered": [call_id], "status": "ok", "targetRunId": result.get("targetRunId")})
    session.answered_calls.add(call_id)
    _persist_session(session)
    for row in result.get("runs", []):
        yield ev(
            "experiment_completed",
            runId=row.get("runId"),
            metrics=row.get("metrics"),
            parentRunId=row.get("parentRunId"),
        )
    if result.get("comparison"):
        yield ev("comparison_created", comparison=result["comparison"])
    yield ev(
        "observation_ready",
        text=result.get("summary") or "实验完成——数字全部来自后端引擎（与浏览器同一执行器）的真实 ExperimentRun。",
        evidence="AI_INFERENCE",
    )
    # chaining contract: the NEXT turn's baseRunId (latest run of this turn)
    yield ev("done", reason="completed", targetRunId=result.get("targetRunId"))


async def sop_resume(result: dict) -> AsyncGenerator[dict, None]:
    runs = result.get("runs", [])
    if runs:
        for row in runs:
            yield ev(
                "experiment_completed",
                runId=row.get("runId"),
                metrics=row.get("metrics"),
                parentRunId=row.get("parentRunId"),
                durationMs=row.get("durationMs"),
            )
    if result.get("comparison"):
        yield ev("comparison_created", comparison=result["comparison"])
    yield ev(
        "observation_ready",
        text=result.get("summary") or "实验完成——数字见 Comparison 纸（全部来自本地真实计算）。",
        evidence="AI_INFERENCE",
    )
    yield ev("done", reason="completed")


# --------------------------------------------------------------------------
# AgentScope backend (real Qwen when DASHSCOPE_API_KEY is present)
# --------------------------------------------------------------------------

_agentscope_sessions: dict[str, Any] = {}

_SYSTEM_PROMPT = (
    "You are Paper2Lab's Research Orchestrator. Users ask questions about a "
    "scientific paper experiment shown on an infinite research desk.\n"
    "Rules:\n"
    "1. NEVER state numeric results from your own knowledge.\n"
    "2. Call scientific_execute to run the experiment steps in the user's "
    "browser — it returns real ExperimentRuns (fork → change parameter → "
    "measure → compare style steps).\n"
    "3. Optionally call canvas_apply afterwards to grow the desk "
    "(ops: {'op':'compare'} | {'op':'highlight-source','anchorId':...} | "
    "{'op':'focus','target':'chart'}).\n"
    "4. Finish with ONE short sentence citing run ids and the measured "
    "differences the tool returned. Finite-scale results are never proofs.\n"
    "5. Your FINAL message must contain a plain-text answer (content), not "
    "only internal reasoning — reasoning-only replies produce no observation."
)


# ---- registry-driven tool surface (#30) -------------------------------------
# The model's tool declaration is GENERATED from the live Skill Registry via
# the engine bridge — one capability source for Qwen and SOP. The old
# hardcoded formula/kakeya-only schema silently hid ode/geometry/mujoco/
# challenge from the model.

_DESK_PREFIXES = ("formula", "kakeya", "ode", "geometry", "mujoco", "challenge")
_surface_cache: dict[str, Any] = {"at": 0.0, "surface": None}


async def _tool_surface() -> dict[str, Any]:
    """desk enum + skill list from the REAL registry (cached 60s). Falls back
    to the conservative built-in list when the engine is unreachable — the
    fallback is smaller, never invented."""
    import time as _time

    now = _time.time()
    if _surface_cache["surface"] is not None and now - _surface_cache["at"] < 60:
        return _surface_cache["surface"]
    fallback = {
        "desks": ["formula", "kakeya"],
        "skills": ["formula.plot", "kakeya.measure"],
        "source": "fallback",
    }
    try:
        from server.engine_bridge import bridge

        resp = await bridge.call("skills")
        # the engine lists exactly the REGISTERED, executable skills (no
        # implemented flag in the payload — presence = runnable)
        names = [str(s.get("name", "")) for s in resp.get("skills", []) if s.get("name")]
        desks = sorted({n.split(".")[0] for n in names if n.split(".")[0] in _DESK_PREFIXES})
        surface = {
            "desks": desks or fallback["desks"],
            "skills": sorted(names),
            "source": "registry",
        }
    except Exception:  # noqa: BLE001 — engine unreachable: smaller honest surface
        surface = fallback
    _surface_cache.update(at=now, surface=surface)
    return surface


def _external_tool_cls() -> Any:
    """agentscope ToolBase subclass: external tool — the browser/engine is the
    executor; the agent parks (Lane B: never concurrent, mutates lineage)."""
    from agentscope.permission import PermissionBehavior, PermissionDecision
    from agentscope.tool._base import ToolBase

    class _ExternalTool(ToolBase):
        is_concurrency_safe = False
        # AgentScope 2.0.9 permission engine reads this class attribute before
        # any check runs — omitting it crashed the FIRST real-model turn
        # ("'_ExternalTool' object has no attribute 'is_read_only'")
        is_read_only = False

        def __init__(self, name: str, description: str, input_schema: dict) -> None:
            super().__init__()
            self.is_external_tool = True
            self.name = name
            self.description = description
            self.input_schema = input_schema

        async def check_permissions(self, *_args: Any, **_kwargs: Any) -> PermissionDecision:
            return PermissionDecision(
                behavior=PermissionBehavior.ALLOW,
                message="browser-side scientific execution is always allowed",
            )

    return _ExternalTool


def _scientific_execute_tool(surface: dict[str, Any]) -> Any:
    desks = surface["desks"]
    skills = ", ".join(surface["skills"])
    return _external_tool_cls()(
        "scientific_execute",
        (
            "Run registered Paper2Lab scientific skills (the ONLY source of "
            f"CALCULATED numbers). Registered skills: {skills}. Input: "
            "{deskKind, steps:[{op,...}]}. deskKind is one of "
            f"{desks}; steps are validated server-side against the same "
            "registry — unknown ops fail explicitly. Typical ops per desk: "
            "experiment.fork / <desk>.set / <desk>.scale / <desk> terminal "
            "(e.g. formula.plot, kakeya.measure, ode.solve, geometry.plot, "
            "mujoco.simulate, challenge.attempt) / experiment.compare."
        ),
        {
            "type": "object",
            "required": ["deskKind", "steps"],
            "properties": {
                "deskKind": {"type": "string", "enum": desks},
                "steps": {"type": "array", "items": {"type": "object"}},
            },
        },
    )


# ---- section-budgeted agent context (#30) ------------------------------------
# the OLD prompt hard-truncated the whole context JSON at 1200 chars; now
# each section (paper / formulas / current experiment / history) gets its own
# budget so anchors, units and history runs survive instead of being chopped
_CONTEXT_BUDGETS = {"paper": 400, "formulas": 500, "current": 300, "history": 500}


def _build_context_message(intent: str, context: dict) -> str:
    sections: list[str] = [f"User question: {intent}"]
    paper = context.get("paper")
    if isinstance(paper, dict):
        title = str(paper.get("title", ""))[:120]
        question = str(paper.get("question", ""))[:200]
        sections.append(f"Paper: {title} — research question: {question}"[: _CONTEXT_BUDGETS["paper"]])
    formulas = context.get("formulas")
    if isinstance(formulas, list) and formulas:
        lines = [
            f"- {str(f.get('latex', ''))[:80]} (anchor {str(f.get('anchorId', '?'))[:24]})"
            for f in formulas[:6]
        ]
        sections.append(("Paper formulas (LaTeX, anchored):\n" + "\n".join(lines))[: _CONTEXT_BUDGETS["formulas"]])
    current = context.get("current")
    if isinstance(current, dict):
        sections.append(f"Current experiment config: {json.dumps(current, ensure_ascii=False)}"[: _CONTEXT_BUDGETS["current"]])
    history = context.get("history")
    if isinstance(history, list) and history:
        recent = list(history)[-6:][::-1]  # newest first, bounded
        rows = [
            f"- run …{str(h.get('runId', ''))[-12:]} params={json.dumps(h.get('params', {}), ensure_ascii=False)} metrics={json.dumps(h.get('metrics', {}), ensure_ascii=False)}"
            for h in recent
        ]
        sections.append(("Recent experiment runs (real, citable):\n" + "\n".join(rows))[: _CONTEXT_BUDGETS["history"]])
    return "\n\n".join(sections)


async def _build_agent() -> Any:
    from agentscope.agent import Agent
    from agentscope.tool import Toolkit

    # #30: the model's scientific tool is GENERATED from the live registry
    surface = await _tool_surface()
    skill_tool = _scientific_execute_tool(surface)
    canvas_tool = _external_tool_cls()(
        "canvas_apply",
        (
            "Apply canvas operations so results appear on the research desk. "
            "ops: {'op':'compare'} | {'op':'highlight-source','anchorId':...} | "
            "{'op':'focus','target':'chart'} | {'op':'fork-paper'}."
        ),
        {
            "type": "object",
            "required": ["ops"],
            "properties": {"ops": {"type": "array", "items": {"type": "object"}}},
        },
    )

    # unified provider layer (#29): OpenAI-compatible base_url or DashScope,
    # env-only credentials, explicit sop fallback on failure
    model = build_model(resolve_provider())
    return Agent(
        name="research-orchestrator",
        system_prompt=_SYSTEM_PROMPT,
        model=model,
        toolkit=Toolkit(tools=[skill_tool, canvas_tool]),
    )


def _evt_type(chunk: Any) -> str:
    """Normalized (lowercase) event type for matching.

    AgentScope's EventType enum values are UPPERCASE ('REQUIRE_EXTERNAL_EXECUTION',
    verified against the installed agentscope 2.0.9); comparing raw values against
    lowercase names silently dropped execution requests from the real backend.
    """
    t = getattr(chunk, "type", "")
    return str(getattr(t, "value", t) or "").lower()


async def agentscope_stream(
    session_id: str,
    inputs: Any,
    server_execute: bool = False,
    intent: str = "",
    context: dict | None = None,
) -> AsyncGenerator[dict, None]:
    """stream one agent interaction. With server_execute=True the tool call
    the REAL model just made is run through the ENGINE BRIDGE headlessly and
    the result is fed back into the same agent — the turn completes without
    a browser (#30/#29 real-model integration)."""
    from agentscope.event import ExternalExecutionResultEvent
    from agentscope.message import ToolResultBlock, ToolResultState

    agent = _agentscope_sessions.get(session_id)
    if agent is None:
        agent = await _build_agent()
        _agentscope_sessions[session_id] = agent

    final_text = ""
    global _last_ok_summary
    _last_ok_summary = None
    rounds = 0
    while True:
        rounds += 1
        if rounds > _MAX_AGENT_SERVER_ROUNDS:
            yield ev("error", message=f"agent exceeded {_MAX_AGENT_SERVER_ROUNDS} execution rounds (each failing?) — turn aborted")
            return
        saw_external = False
        resume_blocks: list = []
        async for chunk in agent.reply_stream(inputs):
            etype = _evt_type(chunk)
            if etype == "tool_call_start":
                yield ev("tool_started", tool=getattr(chunk, "name", ""))
            elif etype == "require_external_execution":
                saw_external = True
                for call in chunk.tool_calls:
                    try:
                        args = json.loads(call.input) if call.input else {}
                    except json.JSONDecodeError:
                        args = {"raw": call.input}
                    if not server_execute:
                        # browser is the executor — park and forward (Lane B)
                        yield ev(
                            "require_execution",
                            toolCallId=call.id,
                            replyId=chunk.reply_id,
                            tool=call.name,
                            args=args,
                        )
                        continue
                    # SERVER execution: run the model's own steps through the
                    # same engine bridge the SOP path uses, then feed back
                    yield ev(
                        "tool_started",
                        toolCallId=call.id,
                        tool=call.name,
                        mode="server",
                    )
                    ok, payload = await _server_run_tool_call(call, args, intent, context or {})
                    yield ev("tool_result", toolCallId=call.id, status="ok" if ok else "error",
                             **({"summary": payload} if ok else {"error": payload}))
                    if ok and isinstance(payload, dict):
                        runs = payload.get("runs") or []
                        cmp_ = payload.get("comparison")
                        bits = [f"run …{r.get('runId', '')[-8:]} metrics={json.dumps(r.get('metrics', {}), ensure_ascii=False)}" for r in runs[-2:]]
                        if cmp_:
                            bits.append(f"comparison={json.dumps(cmp_, ensure_ascii=False)[:200]}")
                        if bits:
                            _last_ok_summary = "；".join(bits)
                    state = ToolResultState.SUCCESS if ok else ToolResultState.ERROR
                    out = payload if ok else {"error": payload}
                    resume_blocks.append(
                        ToolResultBlock(id=call.id, name=call.name or "scientific_execute",
                                        output=json.dumps(out, ensure_ascii=False)[:8000], state=state)
                    )
            elif etype == "reply_end" and not saw_external:
                reason = getattr(chunk, "finished_reason", "completed")
                yield ev("done", reason=str(reason))
            elif chunk.__class__.__name__ == "Msg":
                for blk in getattr(chunk, "content", []) or []:
                    t = getattr(blk, "text", None)
                    if t:
                        final_text += t
        if not (server_execute and saw_external and resume_blocks):
            break
        # feed the engine results back; the agent continues (bounded rounds)
        inputs = ExternalExecutionResultEvent(
            reply_id="", execution_results=resume_blocks,
        )
    if final_text:
        yield ev("observation_ready", text=final_text, evidence="AI_INFERENCE")
    elif server_execute and _last_ok_summary is not None:
        # reasoning models sometimes end without plain content — surface the
        # REAL run numbers as the observation instead of nothing (labeled)
        yield ev(
            "observation_ready",
            text=f"模型未给出文字结论；真实计算结果：{_last_ok_summary}",
            evidence="AI_INFERENCE",
        )


_last_ok_summary: str | None = None


async def _server_run_tool_call(call: Any, args: dict, intent: str, context: dict) -> tuple[bool, Any]:
    """execute a model-proposed tool call through the engine bridge (#29/#30):
    scientific_execute → agent_steps (plan registered engine-side per #32);
    canvas_apply → no headless surface in 0.1, answered honestly."""
    tool = str(getattr(call, "name", "") or args.get("tool") or "scientific_execute")
    if tool == "canvas_apply":
        return False, "canvas_apply has no headless surface in 0.1 — answer from the run results"
    desk = str(args.get("deskKind") or context.get("deskKind") or "formula")
    steps = args.get("steps") if isinstance(args.get("steps"), list) else []
    meta = {
        "kakeya": "kakeya.measure", "ode": "ode.solve", "geometry": "geometry.2d",
        "mujoco": "mujoco.simulate", "challenge": "challenge.attempt",
    }.get(desk, "formula.plot")
    plan = {
        "planId": f"plan-agent-{uuid.uuid4().hex[:8]}",
        "goal": f"Agent 提出的实验：{intent[:80]}",
        "skill": meta,
        "metrics": [],
        "nonClaims": ["有限尺度数值实验，不构成证明"],
        "steps": steps,
    }
    from server.engine_bridge import bridge

    base = context.get("base") if isinstance(context.get("base"), dict) else {}
    if not base and isinstance(context.get("current"), dict):
        # current carries the live experiment spec when the browser sends it
        # (expression/parameters/values); a bare values map only works for
        # desks whose base is parameter-only
        base = context["current"]
    try:
        resp = await bridge.call(
            "agent_steps", deskKind=desk, steps=steps, base=base,
            planId=plan["planId"], plan=plan,
        )
    except TimeoutError:
        return False, "engine timed out"
    if not resp.get("ok"):
        return False, resp.get("error", "engine error")
    return True, resp.get("result")


# --------------------------------------------------------------------------
# HTTP surface
# --------------------------------------------------------------------------


class TurnBody(BaseModel):
    sessionId: str
    intent: str
    context: dict = {}
    resume: dict | None = None


def _sse(events: AsyncGenerator[dict, None]) -> StreamingResponse:
    async def gen() -> AsyncGenerator[bytes, None]:
        try:
            async for e in events:
                yield f"data: {json.dumps(e, ensure_ascii=False)}\n\n".encode()
        except Exception as exc:  # noqa: BLE001 — surface stream errors to client
            yield f"data: {json.dumps(ev('error', message=str(exc)))}\n\n".encode()

    return StreamingResponse(gen(), media_type="text/event-stream")


class RouteBody(BaseModel):
    """paper digest for server-side LLM routing assist (#29)"""

    title: str = ""
    formulas: list[dict] = []
    textHead: str = ""


@router.post("/route")
async def agent_route(body: RouteBody) -> dict:
    """LLM assist for adapter routing, SERVER-SIDE (#29): the browser sends a
    paper digest and may get a formula INDEX back — re-validated locally.
    The browser holds no provider keys. `enhanced` is False unless the AI
    actually answered; failures carry their reason instead of a silent
    deterministic pass-off."""
    status = resolve_provider()
    out: dict[str, Any] = {
        "enhanced": False,
        "provider": status.provider,
        "backend": status.backend,
        "keyFormulaIndex": None,
        "reason": "",
    }
    if status.provider != "openai" or not status.ok:
        out["reason"] = "; ".join(status.issues) or "no AI provider configured"
        return out
    import httpx

    digest = {"title": body.title, "formulas": body.formulas, "textHead": body.textHead[:1500]}
    url = (status.base_url or "").rstrip("/") + "/chat/completions"
    payload = {
        "model": status.model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You refine the formula choice for an ingested paper. "
                    "Return ONLY JSON: {\"keyFormulaIndex\": integer|null, \"reason\": string}. "
                    "keyFormulaIndex must index the provided formulas array. No other fields."
                ),
            },
            {"role": "user", "content": json.dumps(digest, ensure_ascii=False)},
        ],
        "temperature": 0,
        "max_tokens": 200,
    }
    headers = {"Authorization": f"Bearer {_env('PAPER2LAB_AGENT_API_KEY') or ''}"}
    try:
        async with httpx.AsyncClient(timeout=min(status.timeout_s, 20.0)) as client:
            resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code != 200:
            out["reason"] = f"HTTP {resp.status_code}: {resp.text[:160]}"
            return out
        # reasoning models can leave message.content null (the answer lives
        # in reasoning_content) — refine is OPTIONAL: fall back to the
        # deterministic choice instead of a 500
        content = (resp.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
        if not isinstance(content, str) or "{" not in content:
            out["reason"] = "AI returned no parsable content — kept deterministic choice"
            return out
        parsed = json.loads(content[content.find("{"): content.rfind("}") + 1] or "null")
        idx = parsed.get("keyFormulaIndex") if isinstance(parsed, dict) else None
        if isinstance(idx, int) and 0 <= idx < len(body.formulas):
            out["enhanced"] = True
            out["keyFormulaIndex"] = idx
            out["reason"] = str(parsed.get("reason") or "AI 选择")[:200]
        else:
            out["reason"] = "AI answer carried no usable index"
    except (httpx.HTTPError, ValueError) as exc:
        out["reason"] = f"{type(exc).__name__}: {exc}"[:200]
    return out


@router.get("/health")
async def health() -> dict:
    """Provider truth (#29): what is CONFIGURED, what a live probe showed,
    and whether a real AI turn ever succeeded. Never a bare ok:true —
    'configured' is reported separately from 'connected'."""
    status = resolve_provider()
    probe = await probe_capabilities(status)
    return {
        "ok": True,
        "backend": status.backend,
        "provider": status.describe(),
        "probe": probe.as_dict(),
        "aiVerified": ai_verified(),
    }


def _agentscope_input(body: "TurnBody") -> Any:
    """turn body → AgentScope input (resume result or user message)."""
    if body.resume is not None:
        from agentscope.event import ExternalExecutionResultEvent
        from agentscope.message import ToolResultBlock, ToolResultState

        r = body.resume
        rows = r.get("executionResults", [])
        if not rows:
            raise ValueError("resume without executionResults")
        blocks = []
        for row in rows:
            state = ToolResultState.SUCCESS if row.get("status", "ok") == "ok" else ToolResultState.ERROR
            blocks.append(
                ToolResultBlock(
                    id=row.get("toolCallId", ""),
                    name=row.get("tool", "scientific_execute"),
                    output=json.dumps(
                        row.get("result", {}) if state == ToolResultState.SUCCESS else {"error": row.get("error", "external execution failed")},
                        ensure_ascii=False,
                    ),
                    state=state,
                )
            )
        return ExternalExecutionResultEvent(reply_id=r.get("replyId", ""), execution_results=blocks)
    from agentscope.message import UserMsg

    return UserMsg(
        name="desk",
        content=_build_context_message(body.intent, body.context),
    )


async def orchestrator_stream(body: "TurnBody", status: Any) -> AsyncGenerator[dict, None]:
    """AI backend with an EXPLICIT sop fallback (#29).

    The first event always states the live provider/model/aiVerified. A
    provider that fails BEFORE emitting any agent event (bad credentials,
    unreachable endpoint, build error) falls back to SOP with the reason
    in-band — a mid-stream failure stays a failure; partial turns are never
    silently re-run on the fallback."""
    yield ev("backend", **status.describe(), aiVerified=ai_verified())
    try:
        agent_input = _agentscope_input(body)
    except ValueError as exc:
        yield ev("error", message=str(exc))
        return
    emitted = False
    server_mode = body.context.get("execution") == "server"
    try:
        agen = agentscope_stream(
            body.sessionId, agent_input,
            server_execute=server_mode, intent=body.intent, context=body.context,
        )
        async for e in agen:
            emitted = True
            yield e
        return
    except Exception as exc:  # noqa: BLE001 — the fallback IS the error policy
        if emitted:
            raise
        yield ev(
            "sop_fallback",
            backend="sop-deterministic",
            provider=status.provider,
            reason=f"{type(exc).__name__}: {exc}"[:300],
        )
        async for e in sop_dispatch(body):
            yield e


@router.post("/turn")
async def turn(body: TurnBody) -> StreamingResponse:
    status = resolve_provider()
    if status.backend != "sop-deterministic":
        return _sse(orchestrator_stream(body, status))
    return _sse(sop_dispatch(body))

async def sop_dispatch(body: TurnBody) -> AsyncGenerator[dict, None]:
    # deterministic SOP backend (#29: generator form — orchestrator_stream
    # delegates here on explicit fallback)
    session = _sop_sessions.setdefault(body.sessionId, SopSession(id=body.sessionId))
    desk = str(body.context.get("deskKind", "formula"))
    server_mode = body.context.get("execution") == "server"
    if not server_mode and desk in ("ode", "geometry", "mujoco", "challenge"):
        # these desks have no browser execution surface (agentBridge executes
        # formula/kakeya only) — don't promise a turn that can never complete
        async for _e in _single_event("done", reason="not-an-experiment"):
            yield _e
        return
    if server_mode:
        # server mode never pauses for the browser → no resume contract
        if body.resume is not None:
            async for _e in _single_error("server-execution turns do not accept resumes"):
                yield _e
            return
        async for _e in sop_turn_server(session, body.intent, body.context):
            yield _e
        return
    if body.resume is not None:
        rows = body.resume.get("executionResults", [])
        if not rows:
            async for _e in _single_error("resume without executionResults"):
                yield _e
            return
        # Lane B tool-name guard: results must answer an ALLOWED tool — a
        # forged row claiming another tool never reached the executor
        for row in rows:
            tool = str(row.get("tool", "scientific_execute"))
            if tool not in ALLOWED_TOOLS:
                async for _e in _single_error(f"resume carries a tool this orchestrator never registers: {tool}"):
                    yield _e
                return
        # issued-guard: every resumed toolCallId must be one THIS session
        # actually emitted via require_execution — unknown/never-issued ids
        # are rejected (the server used to accept results for calls it never
        # made)
        for row in rows:
            call_id = str(row.get("toolCallId", ""))
            if call_id not in session.issued_calls:
                async for _e in _single_error(f"toolCallId was never issued by this session: {call_id or '(missing)'}"):
                    yield _e
                return
        # Lane B round guard: the resume must echo the CURRENT round nonce.
        # A stale round (replaying an earlier turn's pause after the next
        # turn already started) is rejected instead of silently mis-merging.
        resume_round = body.resume.get("roundId")
        if session.current_round and resume_round != session.current_round:
            async for _e in _single_error(
                f"resume round mismatch: expected {session.current_round}, got {resume_round or '(missing)'} — stale replayed rounds are rejected",
            ):
                yield _e
            return
        # Lane B batch completeness: the resume must answer EXACTLY the calls
        # issued in the current round — no partial batches, no extras
        answered_ids = {str(row.get("toolCallId", "")) for row in rows}
        pending = session.round_calls - session.answered_calls
        if pending and answered_ids != pending:
            async for _e in _single_error(
                f"batch incomplete: round issued {sorted(pending)}, resume answers {sorted(answered_ids)} — partial or extra rows are rejected",
            ):
                yield _e
            return
        # duplicate-resume guard: a toolCallId may be answered exactly once
        fresh = [row for row in rows if row.get("toolCallId") not in session.answered_calls]
        if not fresh:
            async for _e in _single_error("all toolCallIds in this resume were already answered"):
                yield _e
            return
        for row in rows:
            call_id = str(row.get("toolCallId", ""))
            if call_id:
                session.answered_calls.add(call_id)
        # the round is settled — clear the token so a later duplicate is
        # caught by the batch/duplicate guards rather than the round guard
        session.current_round = None
        session.round_calls = set()
        _persist_session(session)
        failed = [row for row in fresh if row.get("status") == "error"]
        if failed:
            # a failed external execution is reported as failure — never done
            session.history.append({"failed": [f.get("toolCallId") for f in failed]})
            session.rounds = 0  # turn terminated (failed) — reset the budget
            _persist_session(session)
            async for _e in _failure_resume(failed):
                yield _e
            return
        merged = {
            "runs": [run for row in fresh for run in row.get("result", {}).get("runs", [])],
            "comparison": next(
                (row.get("result", {}).get("comparison") for row in fresh if row.get("result", {}).get("comparison")),
                None,
            ),
            "summary": "实验已由浏览器完成，来源见实验纸。",
        }
        session.history.append({"resume": merged})
        session.rounds = 0  # turn completed — reset the per-turn resume budget
        _persist_session(session)
        async for _e in sop_resume(merged):
            yield _e
        return
    # a NEW intent starts a fresh turn: the round limit bounds resume cycles
    # WITHIN one turn (runaway tool loops), never the lifetime of the desk
    # session (PaperDesk reuses one sessionId across many questions)
    session.rounds += 1
    if session.rounds > MAX_ROUNDS:
        async for _e in _single_error(f"session exceeded {MAX_ROUNDS} execution rounds"):
            yield _e
        return
    session.history.append({"intent": body.intent})
    _persist_session(session)
    async for _e in sop_turn(session, body.intent, body.context):
        yield _e


def _single_error(message: str) -> AsyncGenerator[dict, None]:
    async def gen() -> AsyncGenerator[dict, None]:
        yield ev("error", message=message)
    return gen()


def _single_event(type_: str, **payload: Any) -> AsyncGenerator[dict, None]:
    async def gen() -> AsyncGenerator[dict, None]:
        yield ev(type_, **payload)
    return gen()


async def _failure_resume(failed: list[dict]) -> AsyncGenerator[dict, None]:
    for row in failed:
        yield ev(
            "experiment_failed",
            toolCallId=row.get("toolCallId"),
            error=row.get("error", "external execution failed"),
        )
    yield ev("done", reason="execution_failed")
