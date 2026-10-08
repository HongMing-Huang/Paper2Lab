# Paper2Lab ingestion server (Docling)

Real PDF → structured JSON: layout, formulas (LaTeX + bbox), figures, tables,
reading order — powered by [Docling](https://github.com/docling-project/docling).

## Offline parsing (no egress: "Network is unreachable / snapshot not found")

Docling pulls its layout/table/formula models on first use. On a machine or
container without internet the FIRST parse dies with
`ConnectError: [Errno 101] Network is unreachable ... cannot find the
appropriate snapshot folder`. Fix once, on a machine WITH network:

```bash
server/.venv/bin/python scripts/download_docling_models.py            # warm the standard HF cache
# or, portable:
server/.venv/bin/python scripts/download_docling_models.py --artifacts /opt/docling-models
export DOCLING_ARTIFACTS_PATH=/opt/docling-models
export PAPER2LAB_DOCLING_OFFLINE=1
```

The Docker image pre-bakes both model families into `/opt/docling-models`
and sets both variables plus `PAPER2LAB_REQUIRE_MODEL_ARTIFACTS=1` — the
ready check fails fast if the artifacts ever go missing instead of letting
the first parse hit the network.

## Run

```bash
# one-time: Python 3.12 venv with docling + fastapi
uv venv server/.venv --python 3.12
uv pip install --python server/.venv/bin/python docling fastapi 'uvicorn[standard]' python-multipart matplotlib

# start (vite proxies /api → 127.0.0.1:8787)
server/.venv/bin/uvicorn server.main:app --port 8787
```

First conversion downloads layout/formula/OCR models (~1 GB, HuggingFace cache).
Subsequent conversions of a 2-page paper take ≈ 15–30 s on CPU.

## API

- `GET /api/health` → `{"ok":true,"engine":"docling","version":"…"}`
- `POST /api/ingest` (multipart `file=<pdf>`) →
  `{docId, engine:"docling", doclingVersion, title, pages:[{page,width,height}],
    items:[{id, kind, page, bbox:{x,y,w,h}, latex?, text?}]}` —
  bbox 是**页宽/高的分数、左上原点**（前端任意渲染尺寸 1:1 映射）；
  formula 项的 `latex` 来自 Docling 公式模型（保留其空格与结尾句点）。

## Regenerate the test fixture

```bash
server/.venv/bin/python scripts/run_ingest_fixture.py
```

## Known parser quirks (baked into the sample generator)

- matplotlib 全文字页：正文附近的游离 line artist 会让 docling-parse 7.22 丢弃整页词（二分定位）；`pdf.fonttype=42` 必需（Type-3 文本层不可抽）。
- matplotlib mathtext 公式会被分类为 picture 而非 formula —— 样例 PDF 用 tectonic（真 LaTeX）排版解决。

## Research Orchestrator (AgentScope)

`server/agent.py`（同一 uvicorn 进程）：

- `GET /api/agent/health` → `{ok, backend: "agentscope-qwen" | "sop-deterministic"}`
- `POST /api/agent/turn` `{sessionId, intent, context, resume?}` → **SSE** 事件流：
  `plan_created / tool_started / require_execution / experiment_completed / comparison_created / observation_ready / done / error`
- 计算永远发生在浏览器：agent 需要数值时发 `require_execution`，前端用与 UI 相同的
  引擎执行注册 skill 并 `resume` 回填（AgentScope `RequireExternalExecutionEvent`/
  `ExternalExecutionResultEvent` 协议）。无 `DASHSCOPE_API_KEY` 时自动回退确定性 SOP
  （同事件流）。Qwen 模型可用 `PAPER2LAB_AGENT_MODEL` 指定（默认 qwen-plus）。
