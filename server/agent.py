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

router = APIRouter(prefix="/api/agent")

_NUM = r"(-?\d+(?:\.\d+)?)"


def _env(name: str) -> str | None:
    return os.environ.get(name) or None


def backend_name() -> str:
    return "agentscope-qwen" if _env("DASHSCOPE_API_KEY") else "sop-deterministic"


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


_sop_sessions: dict[str, SopSession] = {}

MAX_ROUNDS = 5
ALLOWED_TOOLS = ("scientific_execute", "canvas_apply")

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


def sop_plan(intent: str, context: dict) -> dict | None:
    desk = context.get("deskKind", "formula")
    if desk == "kakeya":
        steps = _parse_kakeya_intent(intent)
    else:
        steps = _parse_formula_intent(intent, list(context.get("params", [])))
    if not steps:
        return None
    kakeya = desk == "kakeya"
    return {
        "planId": f"plan-{uuid.uuid4().hex[:8]}",
        "goal": f"用真实实验回答：「{intent[:60]}」",
        "skill": "kakeya.measure" if kakeya else "formula.plot",
        "skillVersion": "ts-kakeya-worker@v3" if kakeya else "cortex-ce@0.142.0",
        "renderer": "r3f" if kakeya else "jsxgraph",
        "metrics": (
            ["occupiedCells", "unionVolume", "multiplicity"]
            if kakeya
            else ["curve", "peak", "integral"]
        ),
        "steps": steps,
        "evidenceBasis": "浏览器 Scientific Runtime（与用户完全相同的引擎）产生的 ExperimentRun",
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
    yield ev(
        "require_execution",
        toolCallId=call_id,
        replyId="",
        tool="scientific_execute",
        args={"deskKind": context.get("deskKind", "formula"), "steps": plan["steps"]},
    )


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
    "differences the tool returned. Finite-scale results are never proofs."
)


def _build_agent() -> Any:
    from agentscope.agent import Agent
    from agentscope.credential import DashScopeCredential
    from agentscope.model import DashScopeChatModel
    from agentscope.permission import PermissionBehavior, PermissionDecision
    from agentscope.tool import Toolkit
    from agentscope.tool._base import ToolBase

    class _ExternalTool(ToolBase):
        """external tool — the browser is the executor; the agent parks."""

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

    skill_tool = _ExternalTool(
        "scientific_execute",
        (
            "Run registered Paper2Lab scientific skills in the user's browser "
            "(the ONLY source of CALCULATED numbers). Input: "
            "{deskKind:'formula'|'kakeya', steps:[{op,...}]}. Valid ops: "
            "experiment.fork, formula.set/scale, formula.plot, "
            "kakeya.halve-n, kakeya.set, kakeya.measure, kakeya.sweep, "
            "experiment.compare. Returns real ExperimentRuns."
        ),
        {
            "type": "object",
            "required": ["deskKind", "steps"],
            "properties": {
                "deskKind": {"type": "string", "enum": ["formula", "kakeya"]},
                "steps": {"type": "array", "items": {"type": "object"}},
            },
        },
    )
    canvas_tool = _ExternalTool(
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

    model = DashScopeChatModel(
        credential=DashScopeCredential(api_key=_env("DASHSCOPE_API_KEY")),
        model=_env("PAPER2LAB_AGENT_MODEL") or "qwen-plus",
        stream=True,
    )
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


async def agentscope_stream(session_id: str, inputs: Any) -> AsyncGenerator[dict, None]:
    agent = _agentscope_sessions.get(session_id)
    if agent is None:
        agent = _build_agent()
        _agentscope_sessions[session_id] = agent

    saw_external = False
    final_text = ""
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
                yield ev(
                    "require_execution",
                    toolCallId=call.id,
                    replyId=chunk.reply_id,
                    tool=call.name,
                    args=args,
                )
        elif etype == "reply_end" and not saw_external:
            reason = getattr(chunk, "finished_reason", "completed")
            yield ev("done", reason=str(reason))
        elif chunk.__class__.__name__ == "Msg":
            for blk in getattr(chunk, "content", []) or []:
                t = getattr(blk, "text", None)
                if t:
                    final_text += t
    if final_text and not saw_external:
        yield ev("observation_ready", text=final_text, evidence="AI_INFERENCE")


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


@router.get("/health")
def health() -> dict:
    return {"ok": True, "backend": backend_name()}


@router.post("/turn")
async def turn(body: TurnBody) -> StreamingResponse:
    if backend_name() == "agentscope-qwen":
        if body.resume is not None:
            from agentscope.event import ExternalExecutionResultEvent
            from agentscope.message import ToolResultBlock, ToolResultState

            r = body.resume
            rows = r.get("executionResults", [])
            if not rows:
                return _sse(_single_error("resume without executionResults"))
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
            result = ExternalExecutionResultEvent(reply_id=r.get("replyId", ""), execution_results=blocks)
            return _sse(agentscope_stream(body.sessionId, result))
        from agentscope.message import UserMsg

        user = UserMsg(
            name="desk",
            content=f"{body.intent}\n\n[desk context] {json.dumps(body.context, ensure_ascii=False)[:1200]}",
        )
        return _sse(agentscope_stream(body.sessionId, user))

    # deterministic SOP backend
    session = _sop_sessions.setdefault(body.sessionId, SopSession(id=body.sessionId))
    if body.resume is not None:
        rows = body.resume.get("executionResults", [])
        if not rows:
            return _sse(_single_error("resume without executionResults"))
        # issued-guard: every resumed toolCallId must be one THIS session
        # actually emitted via require_execution — unknown/never-issued ids
        # are rejected (the server used to accept results for calls it never
        # made)
        for row in rows:
            call_id = str(row.get("toolCallId", ""))
            if call_id not in session.issued_calls:
                return _sse(_single_error(f"toolCallId was never issued by this session: {call_id or '(missing)'}"))
        # duplicate-resume guard: a toolCallId may be answered exactly once
        fresh = [row for row in rows if row.get("toolCallId") not in session.answered_calls]
        if not fresh:
            return _sse(_single_error("all toolCallIds in this resume were already answered"))
        for row in rows:
            call_id = str(row.get("toolCallId", ""))
            if call_id:
                session.answered_calls.add(call_id)
        _persist_session(session)
        failed = [row for row in fresh if row.get("status") == "error"]
        if failed:
            # a failed external execution is reported as failure — never done
            session.history.append({"failed": [f.get("toolCallId") for f in failed]})
            _persist_session(session)
            return _sse(_failure_resume(failed))
        merged = {
            "runs": [run for row in fresh for run in row.get("result", {}).get("runs", [])],
            "comparison": next(
                (row.get("result", {}).get("comparison") for row in fresh if row.get("result", {}).get("comparison")),
                None,
            ),
            "summary": "实验已由浏览器完成，来源见实验纸。",
        }
        session.history.append({"resume": merged})
        _persist_session(session)
        return _sse(sop_resume(merged))
    session.rounds += 1
    if session.rounds > MAX_ROUNDS:
        return _sse(_single_error(f"session exceeded {MAX_ROUNDS} execution rounds"))
    session.history.append({"intent": body.intent})
    _persist_session(session)
    return _sse(sop_turn(session, body.intent, body.context))


def _single_error(message: str) -> AsyncGenerator[dict, None]:
    async def gen() -> AsyncGenerator[dict, None]:
        yield ev("error", message=message)
    return gen()


async def _failure_resume(failed: list[dict]) -> AsyncGenerator[dict, None]:
    for row in failed:
        yield ev(
            "experiment_failed",
            toolCallId=row.get("toolCallId"),
            error=row.get("error", "external execution failed"),
        )
    yield ev("done", reason="execution_failed")
