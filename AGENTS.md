# AGENTS.md — Paper2Lab 最高开发约束（v6）

> 本文件是整个项目的最高开发约束。**每次开发前必须先读本文件**；形成新的长期设计或技术决策后**立即更新本文件**。任何与本文件冲突的临时决定都不允许直接落地，必须先修订本文件。

---

## 0. 产品宪法（v6，含 0.1 规范宪法条款）

1. **Paper2Lab 是可执行论文，不是知识卡片墙。**Canvas 是研究过程的空间历史，不是科学数据源——画布状态只存 shapeId/runId/sourceId/位置/尺寸，科学状态一律在 Scientific Runtime。
2. **能转成实验的问题，Agent 必须创建实验，不能只回答文字。**Agent 输出结构化 Action（fork/change_parameter/measure/compare/observe），不是长文本。
3. **任何显示为 CALCULATED 的数字必须来自真实 Scientific Runtime**（Cortex/Worker/Pyodide 产出的 ExperimentRun）。禁止 React 组件内嵌结果字面量；图表 datapoint 必须携带 runId，点击可回溯到产生它的 Run。
4. **参数必须直接存在于公式和实验纸内部。**禁止独立 Dashboard 参数面板；δ、packing 是公式里可拖动的数字、是 3D 里可抓取的对象、是图上可反拖的点（graph→parameter 与 parameter→graph 双向）。
5. **科学节点必须 Reactive。**参数单一 source of truth（Runtime cell / Observable cell）；禁止在 UI 回调里手工同步 3D/图/文字——参数变化必须自动驱动依赖结果。
6. **所有计算节点必须声明 Evidence 类型**：PAPER（论文原文）/ CALCULATED（本地确定性程序）/ AI_INFERENCE（模型解释）。三者不可混用；AI 不产生数值；有限尺度实验不得表述为"证明了定理"（必须标注 FINITE-SCALE CALCULATION）。
7. **Agent 只能通过注册 Scientific Skills（`src/skills/registry.ts`）和 Canvas Tools 操作系统**；禁止 Agent 自由生成 UI/React/Three 代码作为正式路径；Agent 永远不制造 CALCULATED 数字——数字只能来自浏览器/Worker 真实执行并回填的 ExperimentRun（AgentScope 外部执行协议）。
8. **所有实验必须生成 ExperimentRun**（runId/parentRunId/spec/engine+version/seed/startedAt/durationMs/evidence/errors）；Chart、Metric、3D、Observation 只能引用 runId。
9. **进入实验前必须有结构化 PlayPlan**（goal/inputs/skill/renderer/metrics/evidence/limits，`src/skills/playPlan.ts`）——模块间禁止只传自然语言（FAROS 原则）。
10. **状态三层分离**：CanvasState（tldraw/xyflow 画布）· ScientificState（ExperimentSpec/Run/参数/数据集，在 Runtime 与 explorerStore）· AgentState（PlayPlan/tool calls/会话，`src/desk/agentState.ts` + server session）。禁止混进同一个全局大 Store。
11. **Kakeya P0 闭环**：`manipulate → compute → visualize → observe → fork → compare → trace`。每个环节必须有可演示的交互。
12. **交互优先级**：experiment > computation > visualization > explanation。Agent 的过程不显示"AI 正在思考"——纸面只呈现 PLAN/RUNNING/LOCAL COMPUTE/CALCULATED 状态与新长出的纸。

## 1. 三层交互模式（共享同一 Runtime，禁止复制状态）

| 模式 | 形态 | 进入方式 |
|---|---|---|
| **Paper Mode** | 一张真实论文：问题、定理、公式、内嵌 Live Experiment；公式里的 δ=0.0625 是可拖动数字 | 初始视图（只有 Question + Theorem + Live Experiment） |
| **Lab Canvas** | "展开实验"后实验纸脱离纸面进入无限画布：可移动/缩放/Fork/Compare/成组 | 论文中"展开实验"按钮 |
| **Microscope Mode** | 双击 3D 进入沉浸全屏：尺度 1→ρ→δ 连续 zoom，粗 tube 渐透明、细 tube 展开 | 双击实验纸 3D 区域；Esc 退出回到原实验纸 |

## 2. Reactive Research Runtime（核心）

- 已实现（`src/runtime/`）：param/derive/asyncDerive + useCell；拓扑序失效重算；stale-while-recompute；generation 防乱序；DAG by construction。
- **v3 新增：节点状态机** `idle → stale → computing → resolved → error`（cell.status），UI 必须可视化：拖动中旧数字淡出（CSS opacity 过渡）、图表随 preview 数据移动、exact 计算完成后新 Observation 才出现。
- **拖动交互契约（必须）**：drag → 低分辨率 preview 计算（同步、~16³ 网格）→ 3D/数字连续变化；pointer up → 高分辨率 Worker exact 计算 → CALCULATED 正式结果。preview 结果标注 "preview"，exact 才是正式证据。
- **双向 UI⇄模型**：3D 里抓取 tube 簇移动 → 反向写回 packing 参数（模型更新 UI，UI 也更新模型）。图表点击数据点 → 定位产生它的实验（Data→Experiment）。
- **v4：可追溯性与硬编码禁令**——任何用户可见数值/图必须来自 **ExperimentRun**（`src/experiments/protocol.ts`：runId/spec(params·seed·res)/engine+version/durationMs/evidence=CALCULATED），datapoint 一律携带 runId。**图、3D、Metric、Observation 全部只订阅 Run**（3D 订阅 `tubesRunCell` 的 kakeya.geometry envelope）。除 PAPER 引文与登记配置常量（SEED/VIS_RES/PREVIEW_RES/SWEEP_RES/FINE_DELTA/NeedleSweep GRID·BOX·NEEDLE_HALF/ODE 初值）外禁止内嵌数值；审计清单 `docs/audit/hardcoded-values.md`（A1–A8 已修复）。有限尺度实验不得写成 theorem proof。**Agent（含 Qwen/本地 LLM）只能输出结构化 ExperimentPlan**（toolSchema：白名单+validatePlan+JSON Schema）与 explain_result 的 AI_INFERENCE 文本，禁止产生 CALCULATED 数值（planSmugglesNumbers 拦截）。**v4b：`src/skills/llmPlanner.ts`**——可选 OpenAI 兼容（Qwen）端点：凭据仅从环境变量读取（浏览器 VITE_ 前缀 / node process.env，无字面量），JSON-mode 提示内嵌 tool schema，输出过 validatePlan+smuggle 门，未配置/失败回退确定性 planner。

## 3. 计算架构（三个执行位置，同一统一执行器）

1. **Kakeya Hero Demo：TypeScript + Web Worker（Comlink RPC 封装）**——最低延迟。Skills：generateDirections / generateTubes / interpolatePacking / measureVoxelCover / measureMultiplicity / measureUnionVolume / runScaleSweep。
2. **大尺度：离线预计算 `scripts/precompute_kakeya.cpp`**——C++17 `-O3 -pthread`（`pnpm precompute` 编译并以 `xxl` 档生成：δ=2⁻⁴…2⁻¹⁰ × res 至 1024³ ≈ 1.07×10⁹ 体素（十亿格档，2.1GB 计数器）= 63 行，FNV-1a 封印；档位 large/xl/xxl 可选），`scripts/build_kakeya_bundle.ts` 把每行转成不可变 `kakeya.voxel` ExperimentRun（engine `cpp-precompute`，稳定 runId `kakeya-cpp-d{δ}-p{packing}-n{N}`），后端 `GET /api/engine/kakeya/precomputed` 供给，页面 `ensurePrecomputedRuns()` **原子幂等导入**（失败回退内置 bundle）——大尺度数据点携带真 runId 可回溯。**跨引擎一致性是硬门**：node 执行器与 C++ 同输入 rel<1e-6（曾靠此测试抓出 C++ 两个移植 bug：原点采样区间写错、mulberry32 状态链错），预计算数据必须过此门才能入库。浏览器小尺度实时、大尺度读预计算（参考 bojieli/kakeya-explainer 的教训：δ=1/1000 达数十亿格子，不可傻算）。
3. **后端引擎（0.2）：Node 常驻桥**——`scripts/engine_server.ts`（stdio 行协议，`node --import tsx` 运行**同一份** `src/skills/executor.ts`）+ `server/engine_bridge.py`（子进程管理/按 id 关联/死亡重启）+ `server/engine_api.py`（`POST /api/engine/execute`·`GET /skills|/runs|/kakeya/precomputed`；输入 256KB 上限；PlayPlan 门控与白名单和浏览器完全同构）。后端由此可无头跑通全链路（Agent 编排→真内核→ExperimentRun），浏览器仍是交互执行位置（外部执行协议不变）。ready 检查含 engine（node 缺失=不健康）。
4. **PythonScientificRuntime（为下一篇论文预留）**：独立 Worker + Comlink + Pyodide（numpy/scipy），接口先行（ensureNumpy/runPython/solveIVP 风格），**不得拖慢 Kakeya Demo**；Kakeya 路径禁止走 Pyodide。
4. 本地 LLM（web-llm/transformers.js）：非 P0，仅接口调研。

## 4. Scientific Skills Agent

统一 Skill Registry（11 个 canonical id）：`inspect_source / change_parameter / fork_experiment / simulate_geometry / measure_volume / measure_multiplicity / run_scale_sweep / compare_experiments / explain_result / trace_evidence / open_proof`。Agent = 问题 → 结构化 Action 列表（本地确定性 planner；LLM 可选替换 planner，不进 P0）。示例："如果方向数减少一半呢？" → fork → change_parameter(nTubes 96→48) → measure → compare with parent → observe。执行后画布自动长出第二张实验纸 + Comparison Paper。

## 5. 视觉规范

- 暖白纸面 `#faf6ee` + 极淡点阵（dot `#d8cfc0`）；衬线字体。
- 节点=论文页/实验记录纸/图表页/便签，**不是 Workflow Node**：无默认箭头边、无 flowchart 配色；边为注释式细虚线或不可见。
- 状态可视化：stale=数字淡出+琥珀点、computing=呼吸动画、resolved=新内容淡入。
- 证据徽章：PAPER（朱砂）/ CALCULATED（蓝墨）/ AI INFERENCE（灰虚线）。

## 6. 技术栈与版本（锁定，升级须先 Spike）

react 19.3 / vite 7 / @xyflow/react 12.12 / three 0.186 + fiber 9.8 + drei 10.7 / @observablehq/plot 0.6.17 / mathlive 0.110 / pdfjs-dist 4.10（`?url` worker + convertToViewportRectangle）/ **comlink** / vitest 3。Pyodide 走 CDN v0.27.7 懒加载进 module worker（npm 打包在 Vite 下 loadPackage 失败——克隆 eqs/pyodide-vite 实证）。R3F 节点内嵌需 `nodrag/nowheel` + `eventPrefix="client"`。
**v5 新增（摄入闭环）**：@tldraw/tldraw 5.5（自定义 Shape 走 `TLGlobalShapePropsMap` 增强 + `TLAnyShapeUtilConstructor`；导入必须用 `@tldraw/tldraw`） / @cortex-js/compute-engine 0.142（LaTeX→MathJSON、`compile({to:'javascript'})`） / jsxgraph 1.13（css 需 vite alias 绕过其 exports map） / @observablehq/runtime 6（无官方类型，ambient 声明在 `src/types/observable-runtime.d.ts`） / 后端 docling 2.131 + fastapi（Python 3.12 venv，`server/README.md`）。

## 7. 目录结构

```
AGENTS.md / README.md / docs/research/tech-survey.md / docs/verification/v5/（双闭环截图）
public/papers/wang-zahl-kakeya3d.pdf / sample-harmonic.pdf（tectonic 真排版样例）
server/       Docling 后端（main.py FastAPI + ingest_core.py；README.md 运行说明）
scripts/      precompute_kakeya.cpp（C++17 大尺度预计算）
              make_sample_pdf.py（tectonic 样例论文）· run_ingest_fixture.py（fixture 重生成）
              devservers.sh（tmux 保活 vite+uvicorn，验收脚本前置步骤）
src/
  runtime/     Reactive Runtime（状态机版；Kakeya 路径）
  kakeya/      数学内核（directions/tubes/voxels3d/perron/metrics）
  workers/     voxel.worker（Comlink）、python.worker（Pyodide，接口）
  skills/      Skill Registry（11 canonical）+ planner + llmPlanner
               + adapterRouter（Docling→选适配器）+ formulaPlan（NL→结构化操作）
  canvas/      Paper Mode 页、Lab 节点、Microscope overlay、图表反向导航（Kakeya 路径）
  desk/        v5 摄入桌面：tldraw shapes、explorerStore（Observable Runtime）、
               FormulaChart（JSXGraph）、PdfCanvas、PaperDesk、Home
  formula/     Cortex 管线：engine/analyze/compile/spec（LaTeX→MathJSON→JS）
  ingest/      上传客户端 + doclingSchema 归一化 + fixtures（真实 Docling dump）
  paper/       wangZahl 知识（引文+锚点）、kakeyaGraph（cell 图）、forks
  styles/paper.css · desk.css
  types/observable-runtime.d.ts（ambient 类型）
```

## 8. 允许复用 / 禁止事项

复用：xyflow、three/R3F、Plot、MathLive、pdf.js、Comlink、marimo 思想（不嵌入）、kakeya-explainer 算法思想。
禁止：聊天机器人形态；知识图谱卡片墙；Slider→"运行"按钮模式；Dashboard 参数面板；LLM 产生数值；把有限尺度实验说成证明；复制三模式间的状态。

## 9. Git 与流程

提交前缀 research/feat/fix/perf/test/docs/chore；每个稳定决策同步本文件；每阶段浏览器实测（Console + 交互）后才算完成。

## 10. 当前状态（随进度更新）

v1/v2 已完成（git log + Linear P-CLI-3 CLI-29..45）。v3（2026-10-01）：

- [x] docs/research/tech-survey.md（克隆实读 kakeya-explainer——其 C++ 被 agent 实际编译运行复现 δ=1/1000=456,958,817/3.375B；Needle-Lab 的 Perron 树是装饰性假货；comlink/web-llm 结论）
- [x] Runtime 状态机 idle/stale/computing/resolved/error + 拖动 preview(32³ 同步)/exact(高分辨率 Comlink Worker) 双层（浏览器实测 δ 芯片即拖即变）
- [x] Comlink 封装 voxel worker（measureVoxelCover/measureFamily）
- [x] Skills canonical 11 + 确定性 planner + DeskCanvas 执行器：问题"方向数减少一半"→ 5 个结构化 Action 全✓ → fork 卡/对比卡自动生长 + AI INFERENCE 解释（浏览器实测）
- [x] Paper Mode 初始视图（仅 1 个节点：Question+Theorem+内嵌 Live Experiment；公式内 δ/packing/N 芯片可拖）+ 第一幕针扫掠（96² 栅格实测面积）+ 第二幕 δ-tubes（3D 抓取反向 packing）
- [x] Microscope Mode（双击 3D → 全屏，zoom 1→ρ→δ/4 粗管渐隐细管展开，Esc 返回；实测）
- [x] 图表反向导航：HTML 命中层（Plot 0.6 dot 合并单 path，用 fig.scale(name).apply 定位）；点 title 溯源 runId；fork 自动加分支曲线（实测 +6 点）
- [x] scripts/precompute_kakeya.cpp（-O3 -pthread，atomic uint16 multiplicity，JSON+FNV-1a checksum）：27 行/1.3s/223% CPU，packing=1⇒maxM=N 精确
- [x] PythonScientificRuntime 接口（Comlink+CDN Pyodide worker：ensureRuntime/runPythonJson/solveIVP），不进 Kakeya 路径
- [x] 浏览器全链验收：manipulate→compute→visualize→observe→fork→compare→trace + Console 0 错误；**50/50 vitest**；build ✓
- [x] **生产包（vite build + preview）全链复验**：Paper Mode→Agent（N=48 后 exact 0.4091/1.53×/7）→Lab 9 节点→图表 22 数据点（current 标记随动）→显微镜开/关→Console 0 错误；Paper Mode 截图视觉验收（论文观感、公式正常、芯片协调）
- [x] **连续拖动最强形式验证**：packing 芯片连续拖 → 数字多档滚动（0.5729→0.5109→0.6160→0.6149 exact 收尾）；拖 3D → packing 反向连续更新（0.00→0.20→0.55→1.00）
- [x] Observation 出现动画（exact 版本驱动 obsIn 淡入）；marimo 源码级调研（visitor/edges/graph/cycles/runner 带行号引证，拓扑失效与我们的实现同构）
- [x] Microscope **1 → ρ → δ 三级尺度连续体**（ρ=δ/2 中间层，交错透明度窗口；z=0/0.5/1 三站标签浏览器验证）
- [x] **第二篇论文端到端**：Lotka–Volterra ODE 纸（4 参数芯片 → Pyodide → scipy.solve_ivp → Plot 曲线；懒加载不碰 Kakeya 路径；浏览器实测渲染双种群曲线、Console 干净）——Parameter→Pyodide→solve_ivp→Result→Chart 平台通路落地

v4（2026-10-01 下午，可追溯性重构）：

- [x] 硬编码审计 `docs/audit/hardcoded-values.md`（A1–A8 违规修复：WhatIf 预测数字改定性、文案字面量常量化 PREVIEW_RES/NEEDLE_GRID/BOX²/PERRON_TRIANGLE_AREA/SWEEP_RES/FINE_DELTA、fork sweep 复用 SWEEP_NS/SWEEP_RES；允许项四类登记）
- [x] **ExperimentSpec→Run 协议** `src/experiments/protocol.ts`（runId/spec·seed·res/engine+version/durationMs/evidence）：贯穿 voxelCell、voxelPreviewCell（明示 kakeya.preview 非证据）、sweepCell（每 datapoint 携带 run.runId）、tubesRunCell（kakeya.geometry——**3D 只订阅 Run**）、perronCell（perron.tree）、ODE cell、ForkSnapshot（存源 run 元数据并在卡片显示）
- [x] 六原语全进 Comlink worker + 类型化客户端（node 回退）；手算几何用例 `handcomputed.test.ts`（16/64 轴管、2/8 对角管——纸上逐点推导后编码，一次通过）
- [x] Agent Tool Schema：白名单 14 + validatePlan + planSmugglesNumbers（拒绝 explain_result 携带数值）+ JSON Schema；`llmPlanner.ts` 可选 Qwen 适配（env-only 凭据，浏览器 VITE_/node process.env 安全 accessor，未配置回退确定性 planner）
- [x] 修复 envelope 重构遗留：TraceNode verify 与 perron 全部 `.result` 解包
- [x] **生产包终验（v4 代码）**：acceptance 链全绿——3D ✓ exact 数字 ✓ run badge ✓ packing 改后 0.6010/2.08×/12 ✓ 10 图表点（runId）✓ Observation 引用新 Result ✓ fork 卡显示 `ts-kakeya-worker@v3 · 14ms · run …` ✓ Console 0 错误；64/64 vitest

v5（2026-10-01 晚，"PDF → Playable Paper" 通用摄入闭环）：

- [x] **架构决策：两条摄入路径共用一个产品**。首页（干净 dropzone）→ ①任意上传 PDF → Docling 后端真解析 → tldraw 无限科研桌面（通用 Formula Explorer）；②内置 Wang–Zahl 论文 → 既有 xyflow Lab（v1–v4 Kakeya Hero Demo，作为"专用 Kakeya Adapter"经首页接入）。两条路径共享 ExperimentRun 协议、AGENTS 约束与纸面视觉；**不回迁 xyflow Lab 到 tldraw**（避免推倒 v3/v4 资产）。
- [x] **后端 `server/`（Python 3.12 venv + FastAPI + docling 2.131）**：`POST /api/ingest` 输出 page/bbox(左上原点页分数)/kind(formula·figure·table·caption…)/latex（公式模型原样输出，含结尾句点）；`ingest_core.py` 与 fixture 生成器 `scripts/run_ingest_fixture.py` 共用同一代码路径；vite 代理 `/api→127.0.0.1:8787`；客户端 ingest 带 3 次退避重试（后端冷启动）。
- [x] **Cortex Compute Engine 0.142 管线 `src/formula/`**：`analyzeFormula`（Docling LaTeX→MathJSON→变量分类：x/t/θ 优先自变量、LHS 符号或函数名为输出、其余为参数；剥离 Docling 结尾句点）+ `compileFormula`（`compile(expr,{to:'javascript'})` → 真 JS 函数，`success=false` 时引擎解释器兜底）+ `FormulaExplorerSpec`（type/expression/parameters/independent/renderer:'jsxgraph'——**Agent/AI 只产出此配置，不产出代码**）。测试含真实 Docling fixture 公式逐字解析（1e-12 匹配 2·sin(4.5)）。
- [x] **tldraw 5.5 桌面 `src/desk/`**：五个自定义 Shape（`p2l-paper` PDF 页+Playable 标记+锚点闪烁、`p2l-formula` 浮出公式纸、`p2l-experiment` Interactive Figure、`p2l-chart` 对比卡、`p2l-source` 溯源芯片）；渐进生长：论文页→关键公式 Playable→Play→实验纸→Fork→对比卡，**不预铺卡片墙**。坑位记录：`createShapeId(prefix)` **确定性**（fork 必须自带 explorerId 后缀，否则覆盖原实验）；`stopEventPropagation` 在 v5 是事件级且废弃（改 Interactive 组件 React 合成事件阻断）；tldraw 类型需从 `@tldraw/tldraw` 导入（`tldraw` 包未被 pnpm 提升）。
- [x] **Observable Runtime 6 + JSXGraph 1.13**：参数 cell + `curveRun` cell（361 采样 + peak + ∫|y|dx 梯形积分，包成 `formula.curve` ExperimentRun，engine `cortex-ce-js@0.142.0`）；拖芯片 → `module.redefine` → 曲线连续更新；JSXGraph 曲线重建必须按参数值 useMemo（series 身份漂移会令曲线反复重建、停在淡入 opacity 0）；`registerEvents:false`+pan/zoom 关（画布手势让给 tldraw）。
- [x] **Adapter Router `src/skills/adapterRouter.ts`**：确定性（Kakeya 关键词→kakeya；否则公式评分选关键公式）+ 可选 Qwen（只允许返回 adapter 与公式 index，本地复验）；**NL→结构化操作 `formulaPlan.ts`**（"a 增大一倍"→fork/scale×2/rerun/compare；LLM 输出过 validateFormulaActions 白名单+钳制）。
- [x] **样例论文 `public/papers/sample-harmonic.pdf`**：`scripts/make_sample_pdf.py` 用 tectonic 排版真 LaTeX（y=a·sin(bx) 与 u(t)=e^{−t}cos(ωt) 两个展示公式）+ matplotlib 图；Docling 对其输出 FormulaItem（真实公式识别）。解析器坑：matplotlib 全文字页的游离 line artist 令 docling-parse 7.22 丢整页词；mathtext 公式分类为 picture 非 formula——故正文与公式都用 LaTeX 排版。
- [x] **浏览器双闭环实测（Console 0 错误，截图 docs/verification/v5/）**：①上传 sample-harmonic.pdf→Docling 18 items/2 公式→Playable→Play→拖 a（1.00→4.00，peak 1.000→4.000=|a|，∫8.492→33.970，曲线同步）→Source 镜头回论文+锚点闪烁→Fork→拖 b（base b=1 ∫8.492 vs fork b=3 ∫9.031）→Ask"如果 a 增大一倍会怎样？"→`fork → scale a×2 → rerun → compare`，对比表新增行 a=2.00/peak=2.000/∫16.985≈2×；②Kakeya Lab→实验纸 δ/packing/N 芯片→拖 packing（max m 8→96=N，重叠率 33.4%→39.2%，Worker 真算）→Agent"方向数减半"→5 Action 全✓→Fork A/B 卡 + 对比表（|⋃T| 0.3761→0.2239 −40%）。**89/89 vitest + build ✓**。

v5 注册常量（hardcoded audit 增补，均为配置/呈现，非证据）：`CURVE_SAMPLES=361`、`PAPER_W=560`、`TRIG_DOMAIN=[-7,7]`、`PLAIN_DOMAIN=[-5,5]`、`PARAM_DEFAULTS{default:1,min:-5,max:5,step:0.05}`、`SERIES_COLORS`。

v6（2026-10-01 深夜，Research Orchestrator + Interaction Grammar 完整版）：

- [x] **调研落盘 `docs/research/frameworks-survey.md`**：四仓实读（augmented-math Bind 二元组/正则改 LaTeX 反例、CAScad kernel registry+Observable 变量复用、agentscope 2.x 外部执行协议、FAROS PlanPackage/WorkflowNode/EventLog）+ 六项本仓实证结论与落地映射表
- [x] **Skill Registry `src/skills/registry.ts`**：10 个 0.1 skill 全量声明（name/description/input·output JSON Schema/runtime/renderer/deterministic/version/evidence/runKind），validateSkillInput 门 + 测试；Agent 只能调用注册 skill
- [x] **PlayPlan `src/skills/playPlan.ts`**：FAROS 式实验合同（goal/source/variables·confirmed/assumptions/skill/renderer/metrics/evidenceBasis/successCriteria/nonClaims），formula 与 kakeya 建造器 + 测试
- [x] **ExperimentRun v6 字段**：`startedAt` + `errors[]`（审计合同补齐；全部构造点迁移）
- [x] **Research Orchestrator `server/agent.py`**：FastAPI SSE `/api/agent/turn|/health`；双后端同协议——AgentScope 2.x `Agent`(ReAct) + 两个 `is_external_tool`（scientific_execute/canvas_apply，agent 在 RequireExternalExecutionEvent 停车等浏览器真算，ExternalExecutionResultEvent 回填续跑；DashScope/Qwen，凭据仅 env）｜确定性 SOP 回退（无 DASHSCOPE_API_KEY 时同事件流）；session 服务端保持
- [x] **前端 `src/desk/agentBridge.ts` + `agentState.ts`**：SSE 解析（测试覆盖）→ require_execution 在浏览器用与 UI 完全相同的引擎执行（fork/set/scale→Observable run→compare）→ 结果回填 → **PLAN/RUNNING/LOCAL COMPUTE·Nms→CALCULATED 徽章**（AgentPhaseStrip + 实验纸 phase 徽章）；服务端不可达回退 v5 本地 planner
- [x] **tldraw Binding `p2l-trace`**：实验纸→公式 Shape 的 trace 绑定（TLGlobalBindingPropsMap + BindingUtil，无视觉线，Source 按钮循迹回论文；移动两纸关系不丢）
- [x] **Direct Geometry（graph→parameter）**：JSXGraph 曲线上可拖点 A，40 步二分把 y 反解回第一个参数（单调区间括定检查，公式无关的通用反演）；芯片→图 与 点→参数 双向闭环
- [x] **Packing Challenge（第三幕）**：`src/paper/challengeStore.ts` + ChallengeNode——冻结 N/δ，拖 3D packing 降低 |⋃T|；CURRENT/BEST(你)/BEST(Agent)；"Let Agent Try" 在 packing 网格上用**同一 worker、同 seed、同 res** 逐点真算（AGENT_PACKING_CANDIDATES 登记常量），全部尝试带 runId 入表；明示 FINITE-SCALE 非 proof
- [x] AGENTS.md §0 宪法升 v6（12 条，含三层状态分离/PlayPlan/Agent 只走注册 skill 等新条款）

v6 登记常量：`AGENT_PACKING_CANDIDATES=[1.0,0.95,0.9,0.85,0.8]`（Agent 挑战搜索网格，与用户同引擎）、Direct-Geometry 反演 `ITER=40` 二分步数。

v0.2（2026-10-02 深夜②，后端引擎全链路 + 高规模引擎）：

- [x] **后端引擎服务**：`scripts/engine_server.ts`（Node stdio 行协议，跑同一份统一执行器；ops ping/skills/execute/runs/export/import）+ `server/engine_bridge.py`（asyncio 子进程桥，Popen 阻塞管道全部走 to_thread，死亡自动重启，请求严格串行保血缘顺序）+ `server/engine_api.py`（/api/engine 四端点，256KB 输入上限）；main.py lifespan 关停子进程、/api/ready 增 engine 检查（node 存在性）。pytest 8 项真执行（sin(1)=0.84147…、lv.ode、kakeya.measure、needs_input 门、未知技能拒绝、registry 面、runs 历史、precomputed 供给、ready booted）
- [x] **高规模引擎**：C++ 档位化（`large`=2⁻⁷@256³/2⁻⁸@320³ → `xl`=2⁻⁹@512³ → `xxl`=2⁻¹⁰@**1024³≈1.07×10⁹ 体素**，16GB/10 核实测全档 63 行约 1 分钟、2.1GB 计数器、425% CPU）→ `build_kakeya_bundle.ts` 转 63 个 cpp-precompute Run → 前端 `precomputedRuns.ts`（API 优先/内置 bundle 回退，幂等原子导入，`precomputedPointsCell` 派生当前 δ/packing 序列，δ 芯片与选择网格扩展至 2⁻¹⁰）；ChartUnionNode 假 runId `'precomputed'` 废除——朱砂点全部携带真 runId（点击→Trace）；十亿格档不变量 packing=1⇒maxM=N 精确成立（64/128/256）
- [x] **跨引擎一致性测试抓出两个真 bug**：① C++ 原点采样上界 `1−1.5a`（应为 `1−a/2`，管可出单位立方体）② mulberry32 按值传参导致 RNG 状态链=哈希回写（TS 是 `a+=K` 链），第一抽后流分叉——修复后 node↔C++ rel≈3e-8（边界体素翻转量级），旧 27 行数据集同源错误已随重生成修正
- [x] **产品路径无头证据**：render-webgl-test 第 9 步——真实页面 fetch→导入 45 cpp runs、按钮 `CALCULATED · C++ 高规模已载入 ✓`、图表 caption 含 C++ 序列、console 0 错误（夹具静态服实现同形 /api/engine 路由以验证真 fetch 链）；tsx 入 devDeps（`pnpm engine` 直起引擎）；vitest 4 项（bundle 形状/幂等导入/真 runId/跨引擎一致）
- v0.2 登记常量（hardcoded audit 增补，均为生成器档位/供给面配置）：C++ `CFGS` 标准 9 档 + large 6 档 + xl 3 档(512³) + xxl 3 档(1024³)、`NS={64,128,256}`；前端 `PRECOMPUTED_DELTA_EXPS=[4..10]`、`PRECOMPUTED_PACKINGS=[0,0.5,1]`（与生成器档位一一对应，δ 芯片范围 3…10）；engine 输入上限 256KB、超时 120s（env PAPER2LAB_ENGINE_TIMEOUT）

v0.3（2026-10-03 凌晨②，Agent 底座收口：无头全回合 + canonical 技能面）：

- [x] **步进执行器 `src/skills/agentSteps.ts`**：SOP/LLM 步进词汇（experiment.fork / formula·ode·geometry·kakeya 的 set/scale/terminal / kakeya.halve-n·sweep / experiment.compare）**全部经 executeSkill**（注册表校验+PlayPlan 门+血缘 fork）；参数改动累积到下一个 terminal 物化为 experiment.fork——agent 永不改实验本体，只产生带 parentRunId 的新 Run；四类桌面（公式/Kakeya/ODE/几何）全覆盖，未知 op 显式报错
- [x] **服务端执行模式**：`POST /api/agent/turn` 支持 `context.execution:"server"`——`sop_turn_server` 不再向浏览器发 require_execution，直接经引擎桥 `agent_steps` op 在服务端把整回合跑完（plan_created→tool_started→experiment_completed→comparison_created→observation_ready→done:completed）；ODE/几何桌面首次可完成任务（浏览器模式无执行面时诚实拒绝 not-an-experiment；server 模式无 resume 契约、缺 base 显式失败）；新增 ode/geometry 意图解析器（设为/加倍/减半/比较）
- [x] **canonical 技能别名**：registry 增 `aliases`（fork_experiment / compare_experiments / simulate_geometry / measure_volume / measure_multiplicity / run_scale_sweep ↔ 对应注册技能，输入输出契约相同）；executeSkill 在分发前归一化别名（同受 PlayPlan 门控）；`/api/engine/skills` 面板暴露别名
- [x] 验证：vitest **177/177**（+8：四桌面步进/拒绝路径/别名真执行/别名同受门控）· pytest 快集 **36/36**（+5：四桌面 server 模式全回合 SSE 断言 + 守卫；真数字断言 peak≈|a·2|、conservedDrift<1e-3）· 双产品脚本 PASS · 真实 HTTP SSE 冒烟（plan→tool_started(server)→experiment_completed peak=1.99998）。**坑：Python rf-string 里正则量词 `{0,6}` 会被当成 f-string 替换字段渲染成 "(0, 6)"**——量词必须写 `{{0,6}}`（本坑曾令 group 编号偏移、float('设为') 崩溃）

v0.4（2026-10-05，画布与 Agent 底座升级：Frame Layouts + AgentActionUtil + Drei View，PR #11 关联 issues #11–#13）：

- [x] **Frame Layouts 移植**（源码 tldraw v5.5.0 apps/examples frame-layouts）：`src/desk/boardLayout.ts` 纯函数布局（free/row/grid/spotlight——首个子节点放大为主实验、其余并排缩略，空板不产生 NaN）+ `src/desk/labFrame.tsx` `p2l-lab` 帧（BaseFrameLikeShapeUtil：onChildrenChange 自动重排、onDropShapesOver/onDragShapesOut 动画重排、仅 free 可手动缩放、头栏四种模式切换）；PaperDesk 全部生长点（paper/formula/experiment/chart/source/3d）以 parentId 入帧——论文旁逐步长出实验纸、增删自动重排
- [x] **AgentActionUtil 移植**（源码 tldraw agent-template@7385b3f）：`src/desk/agentActions.ts` 注册表 + 基类契约（sanitizeAction 校验/钳制/拒绝-null、applyAction 单次 editor.run=单步撤销、savesToHistory、getInfo）；五动作：create_experiment（锚点必须存在且有 latex，绝不猜造）/ fork_experiment（参数按 explorer 自身范围钳制，默认取选区）/ compare_experiments（需≥2 实验否则拒绝）/ arrange_lab / focus_shape（spotlight 聚焦选区）；Ask 输入框先走画布意图（聚焦/并排/网格/自由/展开实验）再落公式 planner；`window.__P2L_ACTIONS__.run` 无头证据面；科学执行仍走 explorerStore/executeSkill 同一路径
- [x] **Drei View 3D**（drei 10.7.9 web/View）：`src/desk/RunView3D.tsx` 单一共享 Canvas（fixed + pointerEvents none）+ 每张 `p2l-3d` 实验纸注册 tracked div → `<View track>` 渲染 **kakeya.geometry Run 驱动的管族**（复用导出的 TubesScene），跟随纸的位置/尺寸（帧重排即跟随）；拖拽管族经 Interactive 包装（tldraw v5 形状 HTML 默认 pointer-transparent——必须包 Interactive 才可命中）反写 `kakeya.packing` 进同一响应式 Runtime（badge 0.00→0.70 实测）；顶栏「◈ 长出 3D 实验纸」
- [x] 验证：vitest **188/188**（+11：boardLayout 纯函数 5 + agentActions 校验/拒绝/钳制 6）· tsc 0 错 · pytest 36/36 · 新 `scripts/product-lab-test.mjs`（真实单源 uvicorn+dist）**PASS**：上传→帧内 4 纸生长→arrange row 对齐→spotlight→未知动作拒绝→3D 纸 focus 后 tracked rect 43KB 像素→派发拖拽 badge 0.00→0.70→console 0 错；render/formula 双脚本回归 PASS。**坑：page.mouse 无法命中 tldraw 形状内 HTML（elementFromPoint 落在 tl-background）——产品交互证据用 DOM dispatchEvent 派发到真实 React 处理器（marker/Play 早已如此）；p2l-lab 子形状过小会令内部 min-height 内容 hidden，测试需先 focus_shape 放大**

## 11. 下一阶段（比赛迭代方向）

### 2026-10-01 源码审查后的开发门槛

- v6 的完成勾选只代表历史记录，不替代当前代码、自动测试与浏览器验收。当前迭代禁止启动项目（用户要求）；仅做源码开发、单元测试和构建，交互验收必须记为待验证。
- Formula Explorer 正式图表只绘制 `formula.curve` Run 的采样数据；直接几何反演可调用计算内核，但不可把该调用的数值冒充结果证据。Run 保存表达式、定义域、采样配置、来源与父 Run；保留会话内历史。
- Agent 以选中的 experiment 为目标；没有选择时仅允许唯一实验作为隐式目标。参数改变后的等待必须匹配当前参数与新 Run，旧 Run 只能作为 stale 展示。
- 外部工具批次必须完整执行并一次回填；未知工具、SSE error、超过执行轮数必须显式失败。不能把部分执行后失败自动重试成第二次 Fork。
- Challenge 提交必须匹配冻结的 deltaExp/nTubes/res；不同 baseline 不可混榜。赛事规则未提供前，技术演示验收不得称为正式比赛验收。

1. 视觉打磨：Paper Mode 双栏排版更精细、卡片入场动画、打印级排版细节；tldraw 生产 license（去水印）。
2. Microscope 的 ρ 尺度升级为论文级 tubelet 真模型（当前为 δ/2 视觉过渡层）。
3. web-llm 本地 Agent（语法约束 JSON）替换确定性 planner，Action 形状不变；Qwen 路由实配验证。
4. 摄入桌面增强：多公式 Playable 标记、分页论文 Shape、图表/表格 Anchor、experiment 的 preview/exact 双层（当前 formula.curve 单层即时计算）。
5. 3D 单管抓取（当前为整族 packing 拖动）与 tube 级反向同步。
