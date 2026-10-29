"""VLM fast-path parser: render PDF pages with pypdfium2 and let the
provider's NATIVE MULTIMODAL model read each page image (text, formulas as
LaTeX, tables) — pages run in parallel. This is the "快速理解" path:

- Fast: page render ~0.05s + one vision call per page (4 concurrent), vs
  Docling's CPU layout+formula+OCR pipeline (10-65s/paper on 2vCPU cloud).
- Honest about provenance: engine "vlm" + doclingVersion "<model>@fast-path";
  anchors are page-level (Docling stays the "精读定位" path for char-precise
  boxes). Items keep the same IngestedDoc shape so routing/binding reuse it.

The ONLY remote target is the configured provider endpoint — same env-only
single source (PAPER2LAB_AGENT_BASE_URL/API_KEY/MODEL) as the agent backend.
Every request URL is rebuilt from the base_url that validate_base_url just
accepted in the same function (public http/https host, no redirects).
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import re
import time
import uuid
from typing import Any
from urllib.parse import urlparse

from server.agent_provider import validate_base_url

# render scale ≈150dpi — enough for OCR-grade reading, keeps payloads small
_RENDER_SCALE = 2.0
_MAX_CONCURRENT_PAGES = 4
# hard page cap: over this the fast path REFUSES (reviewer consensus — a
# partial corpus would let routing/experiments run on half a paper; Docling
# 精读定位 has no cap and is the right tool for long PDFs)
_MAX_PAGES = 24


class VLMLimitError(RuntimeError):
    """paper exceeds the fast-path page cap — actionable: use 精读定位"""

_EXTRACT_PROMPT = (
    "你是科学论文解析器。仔细阅读这页论文图片，提取全部内容并以 JSON 返回：\n"
    '{"items":[{"kind":"text","text":"段落原文（保留行内数学的 LaTeX 形式）"},'
    '{"kind":"formula","latex":"独立公式，纯 LaTeX，无 $ 定界"},'
    '{"kind":"table","text":"表格每行用 | 分隔列，首行为表头"}]}\n'
    "规则：按阅读顺序输出；公式必须转成 LaTeX；表格外内容不要塞进 table；"
    "只输出 JSON，不要任何解释。"
)


def render_pages(pdf_path: str, max_pages: int = _MAX_PAGES) -> tuple[list[tuple[int, bytes]], int]:
    """render up to max_pages pages to PNG bytes (page numbers are 1-based).
    Returns (rendered, total_pages) — the caller enforces the cap (over-limit
    papers are REJECTED, never silently half-parsed)."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(pdf_path)
    total = len(pdf)
    out: list[tuple[int, bytes]] = []
    for idx in range(min(total, max_pages)):
        bitmap = pdf[idx].render(scale=_RENDER_SCALE)
        buf = io.BytesIO()
        bitmap.to_pil().save(buf, format="PNG", optimize=True)
        out.append((idx + 1, buf.getvalue()))
    return out, total


def vlm_chat_url(base_url: str) -> str:
    """SSRF-guarded chat endpoint: validate the CONFIGURED base_url (public
    http/https host only — loopback/private/reserved rejected) and derive the
    chat path from it. Raises instead of requesting anything invalid."""
    reason = validate_base_url(base_url)
    if reason:
        raise RuntimeError(f"VLM endpoint rejected: {reason}")
    return base_url.rstrip("/") + "/chat/completions"


async def _extract_page(
    page_no: int,
    png: bytes,
    base_url: str,
    api_key: str,
    model: str,
    timeout: float,
) -> tuple[int, list[dict[str, Any]]]:
    """one vision call for one page → normalized items (may raise). The
    request URL is re-derived from the validated base_url right here."""
    import httpx

    url = vlm_chat_url(base_url)
    b64 = base64.b64encode(png).decode()
    body = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": _EXTRACT_PROMPT},
                ],
            }
        ],
        "max_tokens": 8000,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        resp = await client.post(url, json=body, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    return page_no, _parse_model_items(content)


def _parse_model_items(content: str) -> list[dict[str, Any]]:
    """model returns JSON (possibly fenced/wrapped/occasionally truncated or
    as a bare top-level array) — parse defensively, never crash"""
    m = re.search(r"\{[\s\S]*\}|\[[\s\S]*\]", content)
    if not m:
        return []
    raw_items: Any = None
    for candidate in (m.group(0), _close_truncated(m.group(0))):
        try:
            parsed = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(parsed, list):
            raw_items = parsed  # bare [{"kind":...}] array — accept it
        elif isinstance(parsed, dict):
            raw_items = parsed.get("items")
        if raw_items is not None:
            break
    if raw_items is None:
        # last resort: pull complete {"kind": …} objects out of truncated text
        raw_items = [
            obj
            for chunk in re.findall(r'\{"kind"[\s\S]*?\}', content)
            for obj in [json.loads(chunk)]  # noqa: PERF001 — each is tiny
        ] if _all_jsonable(content) else []
    items: list[dict[str, Any]] = []
    for it in raw_items or []:
        if not isinstance(it, dict):
            continue
        kind = str(it.get("kind") or "text")
        if kind not in ("text", "formula", "table"):
            kind = "text"
        if kind == "formula":
            latex = str(it.get("latex") or "").strip().rstrip(".,;")
            if latex:
                items.append({"kind": "formula", "latex": latex})
        else:
            text = str(it.get("text") or "").strip()
            if text:
                items.append({"kind": kind, "text": text})
    return items


def _close_truncated(fragment: str) -> str:
    """repair a length-truncated JSON payload by closing open braces/brackets
    (in order) and dropping the trailing incomplete token"""
    out = fragment.rstrip().rstrip(',;"')
    opens = [c for c in out if c in "{["]
    closes = 0
    for ch in reversed(out):
        if ch in "}]":
            closes += 1
        elif ch in "{[":
            break
    suffix = "".join("}" if c == "{" else "]" for c in reversed(opens[closes:]))
    return out + suffix


def _all_jsonable(content: str) -> bool:
    try:
        for chunk in re.findall(r'\{"kind"[\s\S]*?\}', content):
            json.loads(chunk)
        return True
    except ValueError:
        return False


def _pipe_table_to_structured(text: str) -> dict[str, Any] | None:
    """VLM tables come back as pipe-separated lines (header first) — convert
    to the SAME {columns, rows} shape real Docling emits, so the browser
    normalizer and parseDataPairs' STRUCTURED path (not its text heuristic)
    feed the fit binding. Returns None when nothing tabular was read."""
    rows: list[list[str]] = []
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 2 or not any(cells):
            continue
        if all(set(c) <= {"-", ":", " ", ""} for c in cells):  # |---|---| rule
            continue
        rows.append(cells)
    if len(rows) < 2:
        return None
    return {"columns": rows[0], "rows": rows[1:]}


async def parse_pdf_with_vlm(
    pdf_path: str,
    provider: dict[str, Any],
    on_stage=None,
) -> dict[str, Any]:
    """fast-path parse: render + concurrent VLM extraction → IngestedDoc
    shape. provider = {"base_url","api_key","model","timeout_s"} resolved by
    the caller from the env-only provider layer (never user input)."""
    # fail fast on an invalid endpoint before rendering anything
    vlm_chat_url(str(provider["base_url"]))
    api_key = str(provider["api_key"])
    model = str(provider["model"])
    timeout = float(provider.get("timeout_s") or 120.0)
    base_url = str(provider["base_url"])

    t0 = time.time()
    pages, total_pages = await asyncio.to_thread(render_pages, pdf_path)
    if not pages:
        raise RuntimeError("VLM 解析：PDF 没有可渲染的页面")
    if total_pages > _MAX_PAGES:
        # reviewer consensus (Copilot+Codex): never hand back a partial
        # corpus as success — the router/agent/experiments would reason over
        # half a paper. Refuse with the actionable alternative.
        raise VLMLimitError(
            f"论文共 {total_pages} 页，超过快速理解上限 {_MAX_PAGES} 页——"
            "请改用「精读定位」模式解析完整论文"
        )
    if on_stage:
        on_stage("vlm-reading")

    sem = asyncio.Semaphore(_MAX_CONCURRENT_PAGES)

    async def bounded(pn: int, png: bytes) -> tuple[int, list[dict[str, Any]]]:
        async with sem:
            # one retry per page: transient shapes (truncation, fenced output,
            # a hiccup) usually clear; a twice-failed page fails the job with
            # page-level evidence instead of a paper-level "0 items"
            last_err: Exception | None = None
            for _attempt in (1, 2):
                try:
                    _, page_items = await _extract_page(pn, png, base_url, api_key, model, timeout)
                    if page_items:
                        return pn, page_items
                    last_err = RuntimeError("model returned no parsable items")
                except Exception as exc:  # noqa: BLE001 — retried, then raised
                    last_err = exc
            assert last_err is not None
            raise RuntimeError(f"page {pn}: {last_err}") from last_err

    results = await asyncio.gather(*(bounded(pn, png) for pn, png in pages))
    by_page = {pn: items for pn, items in results}

    items: list[dict[str, Any]] = []
    n = 0
    title = None
    for pn in sorted(by_page):
        page_items = by_page[pn] or []
        # page-level anchors: Docling gives character-precise boxes; the VLM
        # path gives page-scope anchors (stacked vertically for visibility)
        for j, it in enumerate(page_items):
            y = 0.06 + 0.9 * (j / max(1, len(page_items)))
            if it["kind"] == "formula":
                items.append(
                    {
                        "id": f"p{pn}-i{n}",
                        "kind": "formula",
                        "page": pn,
                        "bbox": {"x": 0.08, "y": round(y, 4), "w": 0.84, "h": 0.04},
                        "latex": it["latex"],
                        # #51 P0-A: honest precision — the VLM path knows the
                        # PAGE, not a real region bbox (the stacked y is a
                        # display layout, never char-precise provenance)
                        "anchorPrecision": "page",
                    }
                )
            else:
                entry: dict[str, Any] = {
                    "id": f"p{pn}-i{n}",
                    "kind": it["kind"],
                    "page": pn,
                    "bbox": {"x": 0.08, "y": round(y, 4), "w": 0.84, "h": 0.04},
                    "text": it.get("text") or "",
                    "anchorPrecision": "page",
                }
                if it["kind"] == "table":
                    structured = _pipe_table_to_structured(it.get("text") or "")
                    if structured:
                        entry["table"] = structured
                items.append(entry)
                if title is None and it["kind"] == "text":
                    title = (it.get("text") or "").split("\n")[0][:80]
            n += 1

    if not items:
        raise RuntimeError("VLM 解析产出 0 个条目——模型未从页面图片读到内容")

    return {
        # uuid suffix: concurrent jobs may start in the same millisecond — a
        # timestamp-only id made two docs collide in persist_doc (review P1)
        "docId": f"vlm-{uuid.uuid4().hex[:12]}",
        "engine": "vlm",
        "doclingVersion": f"{model}@fast-path",
        "title": title or "Untitled paper",
        "pages": [{"page": pn, "width": 612, "height": 792} for pn, _ in pages],
        "items": items,
        "_vlm": {
            "model": model,
            "pages": len(pages),
            "durationMs": int((time.time() - t0) * 1000),
        },
    }
