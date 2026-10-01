# Frameworks Survey — Paper2Lab 0.1 指定参考项目实读结论（2026-10-01）

> 本文件是 §十八 开发前置调研的落地结论。四个仓库已 clone 到 `~/Desktop/paper2lab-research/v5/`（augmented-math/CAScad/agentscope/FAROS）；docling/cortex/observable/jsxgraph/tldraw/r3f 六项结论来自本仓库 v5 的**上手实证**（非纸面阅读）。每条含 file:line 引证。

## 1. docling（实证：server/）
- DoclingDocument 的 `iterate_items()` 逐层产出带 `prov`（page_no + BoundingBox）的 item；formula 是 `FormulaItem`，`.text` 即公式模型预测的 LaTeX（**原样保留空格与结尾句点**）——前端必须容忍并归一。
- bbox 坐标原点有 `BOTTOMLEFT/TOPLEFT` 两种，需按 `coord_origin` 换算；我们归一为左上原点页分数（`server/ingest_core.py`）。
- 实测坑：matplotlib 全文字页的游离 line artist 会令 docling-parse 7.22 丢弃整页词；mathtext 公式分类为 picture 而非 formula。样例 PDF 改用 tectonic 真 LaTeX 排版绕开（`scripts/make_sample_pdf.py`）。

## 2. augmented-math（UIST'23，clone + gh api 实读）
- 流水线是两段式：离线 Python（cnstd 公式检测 `lib/math-extract.py:12-22`、Mathpix OCR、OpenCV 轮廓+骨架 `lib/figure-extract.py:13-42`）→ 在线 React/Konva 前端加载 JSON/SVG（`src/Equations.js:38-61`、`src/Figures.js:47-111`）。
- **Bind 的数据结构极简**：`{figureId, equationId}` 二元组（`src/Canvas.js:59-68`）+ 变量值表 `currentSymbols: {symbolId→number}`（`src/Canvas.js:19`）。没有语义映射——只是"此图配此式"。我们学到的：绑定是**轻量声明**，语义由计算层（Cortex）承担。
- Manipulate→Update 是**纯手写回调链**（`Symbol.onDragMove`→`Canvas.updateValue`→`Graph.update`→`tex-math-parser.evaluateTex` 采样→Konva 重绘，`src/Symbol.js:76-94`、`src/Graph.js:50-82`），且用**正则替换 LaTeX 里的符号**（`src/Canvas.js:108-120`）——这正是我们要避免的两点：无响应式 DAG、字符串手术。Paper2Lab 用 Observable cell + Cortex MathJSON 取代。
- 借鉴：公式↔图的绑定对（我们落地为 tldraw binding）；"从文档长出可操作对象"的渐进节奏（Playable 标记→浮出→实验纸）。

## 3. CAScad（clone 实读）
- MathLive→MathJSON→kernel：`mf.value`(LaTeX) / `mf.expression`(MathJSON)（`js/cells.js:169-175`）；kernel registry 是 `{id,label,available,evaluate}` 契约 + register/setActive（`js/kernel-registry.js:4-71`），注册了 Giac 与 Cortex ComputeEngine 两个 kernel（`js/kernel-compute-engine.js:131-225`）。**我们照此把"计算内核"从 UI 分离**（registry.runtime 字段）。
- Observable 集成：每 cell 一个 `observableModule.variable(observer)`，重定义**复用同一 variable 实例**保住下游接线（`js/reactive-dag.js:206-208,361-365`）；依赖提取靠 tokenizer，只把"他人定义的变量"作为 inputs（`:221-225`）。Paper2Lab 的 explorerStore 已用同构方案（param cell + redefine），并修正了它的"整块销毁重建 JSXGraph"做法（我们 memoize 曲线、按值键控，避免淡入闪烁）。
- 借鉴：`activeInputs` 只认已定义变量（防止把 x/y 误当输入）；级联前预打 pending 态（我们的 cell.status 状态机同构）。

## 4. cortex-js/compute-engine（实证：src/formula/）
- `ce.parse(latex)` → BoxedExpression（`.json`=MathJSON、`.freeVariables`、`.latex`）；`compile(expr,{to:'javascript'})` → `{code, run(vars), freeSymbols, success}`，success=false 时回退引擎解释器。LaTeX→数学语义**只走这一条路**，公式永不靠 LLM 写 JS（AGENTS v5 §2）。

## 5. observablehq/runtime（实证：src/desk/explorerStore.ts）
- `new Runtime().module()` + `variable().define(name, inputs, fn)` + `module.redefine(name, v)` 驱动下游重算——拖芯片只改参数 cell，图表/积分/徽章全部级联，UI 无手工同步。CAScad 的"复用 variable 实例"已内建。

## 6. jsxgraph（实证：src/desk/FormulaChart.tsx）
- `initBoard(el,{boundingbox,axis,boundingbox 动态 setBoundingBox})` + `create('functiongraph',[f,x0,x1])`。坑：新元素有 0.1s CSS 淡入（opacity 0→1），**重建过频会停在 opacity 0**——series 必须按参数值 useMemo（v5 踩过并修复）。`registerEvents:false`+pan/zoom 关闭把手势让给宿主画布。

## 7. tldraw（实证：src/desk/shapes.tsx）
- 自定义 Shape = `TLGlobalShapePropsMap` 模块增强 + `ShapeUtil`（getDefaultProps/getGeometry/component/getIndicatorPath）+ `static props` 校验；Editor API：`createShape/createBinding/select/centerOnPoint(zoomToFit)/getCurrentPageShapes`。
- 坑：`createShapeId(prefix)` **确定性**（fork 必须加唯一后缀）；v5 起 `stopEventPropagation` 废弃（改 React 合成事件阻断）；类型从 `@tldraw/tldraw` 导入。
- 画布只存 shapeId/runId/sourceId/位置/尺寸（AGENTS v6 分层约束），科学状态在 Scientific Runtime。

## 8. react-three-fiber + three（实证：src/canvas/views/Tubes3DView.tsx，v1-v4）
- 仅用于 Kakeya 3D Lab；几何只订阅 `kakeya.geometry` ExperimentRun；拖管子反向写 packing 参数（UI→模型→UI 双向）。普通 2D 数学走 JSXGraph，不进 Three。

## 9. agentscope（clone + 装机 2.0.9 实读）
- 2.x 统一 `Agent`（无 ReActAgent 类名），ReAct 由 `ReActConfig` 开启；`reply_stream(inputs)` 是异步事件生成器（`agent/_agent.py:288-317`）。
- **外部工具协议**（我们的核心通道）：子类 `ToolBase` 置 `is_external_tool=True`（`tool/_base.py:114`），agent 到该工具时 yield `RequireExternalExecutionEvent(reply_id, tool_calls)` 并**停车**（`_agent.py:1238-1261`）；外部执行者回填 `ExternalExecutionResultEvent(reply_id, execution_results: List[ToolResultBlock])` 再次 `reply_stream` 续跑（`event/_event.py:454-529`）。→ 浏览器里真算 scientific skill、Agent 在服务端等待，天然合规"Agent 永不制造 CALCULATED 数字"。
- PlanNotebook 在 2.x 已删除；替代是内建 TaskCreate/TaskUpdate/TaskList 工具 + `InjectionConfig(inject_runtime_state=True)` 注入任务态（`state/_task.py:10`、`agent/_config.py:195-207`）。我们沿用此方向：PlayPlan 以任务工具+结构化输出落地。
- Session：`AgentState` 是 pydantic，`model_dump(mode='json')`/`model_validate` 即持久化（`state/_state.py:209`）；服务端模式照 `app/_service/_chat.py:1160-1170,1464`（每轮存 state，重建时喂回）。
- SSE 只借事件序列化不整个 app：`event.model_dump(mode='json')` + `data: {json}\n\n` + 心跳（`app/_router/_session.py:857-864` 的做法）。
- 模型：`DashScopeChatModel`（OpenAI 兼容端点）；**无 DASHSCOPE_API_KEY 时回退确定性 SOP**（与 v5 llmPlanner 同策略），事件协议不变。

## 10. FAROS（clone 实读）
- PlanPackage（`backend/app/models/plan_package.py:363`）：goal/hypothesis/stages/evidenceTrace/downstreamContract/qualityGate/status 机（draft→…→approved）。→ 我们的 **PlayPlan** 取其骨架（goal/inputs/skill/metrics/renderer/evidence/limits/successCriteria），砍掉多 agent 评审。
- Blueprint 的 WorkflowNode `{capability, inputs, outputs, verifier}`（`faros/models/blueprint.py:6`）+ CapabilityResult `{status, outputs, artifacts, verification}`（`faros/models/capability.py:8`）→ 我们的 **Skill Registry 声明**（input/output schema + runtime + renderer + evidence + version + deterministic）。
- Artifact/Audit：`ArtifactRecord{id,type,producer,summary}`（`faros/models/artifact.py:6`）+ append-only EventLog `{timestamp,level,nodeId,message,details}`（`faros/runtime/event_log.py:17-39`，节点开始/完成/失败/重试各追加）→ 我们的 **ExperimentRun（artifact）+ agent 事件流（audit trail）**同构。
- 模块间禁传自然语言：我们同构——orchestrator→前端只传结构化 tool call/canvas op，前端回传 ExperimentRun JSON。

## 落地映射（本仓库）
| 参考来源 | 落到 Paper2Lab |
|---|---|
| augmented-math Bind 二元组 | tldraw binding：formula shape ↔ experiment shape |
| CAScad kernel registry | `src/skills/registry.ts` 的 runtime/renderer 声明 |
| CAScad/augmented-math 操作节奏 | FormulaWithChips 芯片 + Direct Geometry 反向点 |
| AgentScope 外部执行协议 | server/agent 端 `is_external_tool` + 浏览器真算回填 |
| AgentScope SSE 序列化 | `/api/agent/turn` 事件流（plan_created/tool_started/…） |
| FAROS PlanPackage/WorkflowNode/EventLog | PlayPlan / Skill Registry / ExperimentRun+事件审计 |
