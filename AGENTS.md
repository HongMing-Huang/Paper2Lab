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

v0.5（2026-10-05②，MuJoCo 物理底座 + 魔搭 Docker Studio 可部署）：

- [x] **上游锁定**：`zalo/mujoco_wasm@f6b202ca…`（其依赖 @mujoco/mujoco@3.12.0 官方单线程 WASM，npm 锁定）；`scripts/vendor_mujoco_scenes.ts` 从该提交 tarball（https+host 白名单、XML 拒 DOCTYPE/ENTITY）内置 **17 场景 54 文件**到 `src/physics/scenes/`（manifest 带 sha256 与 provenance；flex.xml 按上游积分器兼容问题排除）
- [x] **Stage A 内核**：`src/physics/mujocoKernel.ts`——上游 test_load.mjs 无头范式（MEMFS 挂载 + mj_loadXML + mj_step），参数在步进前写入真 mjModel.opt（gravityZ/windX/timestep），采样 qpos/qvel/qacc + 指标；**17/17 场景 100 步全有限实测**（含上游未测的 humanoid_body）
- [x] **技能/协议（C）**：registry 新增 `mujoco.simulate`（deterministic/CALCULATED/runKind `mujoco.sim`/PlayPlan 门）；`registerSkillRunner` 引擎侧注册机制（Node-only 内核不进浏览器包；浏览器得到诚实的 engine-only unsupported）；experiment.fork 嵌套 params 合并（gravityZ/windX/timestep 白名单）+ COMPUTE_BY_KIND/inputFromSpec replay
- [x] **Stage B 接口面**：`src/physics/playback.ts` 纯状态机（set_params/start/pause/reset/export_run；clamp、参数变更暂停并置 needsSimulate、无 Run 拒绝 start）——播放器只消费 Run，证据一律来自 simulate
- [x] **Stage D Agent**：agentSteps 第五桌面 `mujoco`（set/scale/simulate/compare；重力加倍=向下×2）+ 意图解析 + server 执行模式全回合（引擎子进程内真 WASM 物理）
- [x] **Stage E 魔搭 Docker**：Dockerfile 三阶段（web 构建 / engine-deps 生产 node_modules（tsx 已移 runtime deps）/ python+node 单源 7860）；`EXPOSE 7860`、`0.0.0.0`、`PAPER2LAB_DATA_DIR=/mnt/workspace`、mujoco.wasm 同源拷贝 public/assets；npmjs 出网不稳时 npmmirror 回退（integrity 锁定不变）；`scripts/ms-container-smoke.sh` 容器冒烟（health/ready/容器内 mujoco 真算/SPA+wasm 200/重启持久化）
- [x] 验证：vitest **216/216**（+28：17 场景参数化、确定性 replay 1e-12、月球重力改变轨迹、PlayPlan 门、血缘 fork+未知参数拒绝、playback 状态机）· pytest 快集 **37/37**（+mujoco 引擎真算 ASGI + server 模式全回合 finalTime=0.4 精确）· tsc 0 错 · 容器冒烟见脚本输出。**坑：@mujoco/mujoco 的 data.qvel/qacc 长度是 nv≠nq（越界读出 NaN）**；corepack 在构建网络差时用 COREPACK_NPM_REGISTRY=npmmirror；**交互验收待验证：拖拽施力（mj_applyFT+射线选中，参照上游 main.js）、3D 画面、鼠标命中**——本轮未启动 GUI

v0.4（2026-10-05，画布与 Agent 底座升级：Frame Layouts + AgentActionUtil + Drei View，PR #11 关联 issues #11–#13）：

- [x] **Frame Layouts 移植**（源码 tldraw v5.5.0 apps/examples frame-layouts）：`src/desk/boardLayout.ts` 纯函数布局（free/row/grid/spotlight——首个子节点放大为主实验、其余并排缩略，空板不产生 NaN）+ `src/desk/labFrame.tsx` `p2l-lab` 帧（BaseFrameLikeShapeUtil：onChildrenChange 自动重排、onDropShapesOver/onDragShapesOut 动画重排、仅 free 可手动缩放、头栏四种模式切换）；PaperDesk 全部生长点（paper/formula/experiment/chart/source/3d）以 parentId 入帧——论文旁逐步长出实验纸、增删自动重排
- [x] **AgentActionUtil 移植**（源码 tldraw agent-template@7385b3f）：`src/desk/agentActions.ts` 注册表 + 基类契约（sanitizeAction 校验/钳制/拒绝-null、applyAction 单次 editor.run=单步撤销、savesToHistory、getInfo）；五动作：create_experiment（锚点必须存在且有 latex，绝不猜造）/ fork_experiment（参数按 explorer 自身范围钳制，默认取选区）/ compare_experiments（需≥2 实验否则拒绝）/ arrange_lab / focus_shape（spotlight 聚焦选区）；Ask 输入框先走画布意图（聚焦/并排/网格/自由/展开实验）再落公式 planner；`window.__P2L_ACTIONS__.run` 无头证据面；科学执行仍走 explorerStore/executeSkill 同一路径
- [x] **Drei View 3D**（drei 10.7.9 web/View）：`src/desk/RunView3D.tsx` 单一共享 Canvas（fixed + pointerEvents none）+ 每张 `p2l-3d` 实验纸注册 tracked div → `<View track>` 渲染 **kakeya.geometry Run 驱动的管族**（复用导出的 TubesScene），跟随纸的位置/尺寸（帧重排即跟随）；拖拽管族经 Interactive 包装（tldraw v5 形状 HTML 默认 pointer-transparent——必须包 Interactive 才可命中）反写 `kakeya.packing` 进同一响应式 Runtime（badge 0.00→0.70 实测）；顶栏「◈ 长出 3D 实验纸」
- [x] 验证：vitest **188/188**（+11：boardLayout 纯函数 5 + agentActions 校验/拒绝/钳制 6）· tsc 0 错 · pytest 36/36 · 新 `scripts/product-lab-test.mjs`（真实单源 uvicorn+dist）**PASS**：上传→帧内 4 纸生长→arrange row 对齐→spotlight→未知动作拒绝→3D 纸 focus 后 tracked rect 43KB 像素→派发拖拽 badge 0.00→0.70→console 0 错；render/formula 双脚本回归 PASS。**坑：page.mouse 无法命中 tldraw 形状内 HTML（elementFromPoint 落在 tl-background）——产品交互证据用 DOM dispatchEvent 派发到真实 React 处理器（marker/Play 早已如此）；p2l-lab 子形状过小会令内部 min-height 内容 hidden，测试需先 focus_shape 放大**

v0.6（2026-10-06，可玩 0.1：三关挑战 + 方向修正取消生图，PR 链 5b408f4→9f2c4df→912d187）：

- [x] **方向修正**：取消 ComfyUI 生图接入；底座改为「代码生成模型→真实计算→直接操纵→目标反馈→重试与比较」。复用 MuJoCo 官方 WASM（程序化几何/`mj_loadXML` 从字符串路径）+ PhET 轨迹/目标判定玩法机制，保留现有引擎与 Run 协议
- [x] **引擎 Run 持久化**：`scripts/engine_persist.ts`（resolved Run 追加 `engine-runs.jsonl`、启动原子恢复）——容器/引擎重启后原 Run 仍可 baseRunId 链续实验（子进程实证 restoredRuns→run_input 可解析）
- [x] **三关内核 `src/challenges/`**：投射命中（程序化 MJCF+keyframe 发射，落点/误差/命中读实测轨迹）、摆周期匹配（keyframe 释放角，周期由真实摆动零交叉测量，T∝√L 实测）、管束压缩（**逐簇偏移**替代全局 packing 标量，真体素计数）；validateSpec 全范围门；三关 replay 逐字节一致
- [x] **ChallengeSpec/事件/Run 统一**：SceneSpec（冻结目标+约束+预算）/ store（用户+Agent 共享一本预算账、失败也扣费、逐 actor 最佳、solved、save/load）/ challenge.attempt 注册技能（PlayPlan 门/COMPUTE_BY_KIND/inputFromSpec 回放链/引擎侧 runner）
- [x] **Agent 同条件**：agentSteps 第六桌面 challenge（多参数一句收齐→set→attempt）+ server 模式回合（pytest 4：命中>1000 分/重试改进/tubes 真体积/浏览器模式诚实拒绝）
- [x] **挑战页 `ChallengesLab`**：三关原子切换/滑杆/即时反馈/历史轨迹 SVG（投射保留历次轨迹）/最佳记录/预算/Agent 按钮——页面执行全走后端引擎并导入 Run（levels.ts 浏览器安全模块隔离 node 依赖）
- [x] 验证：vitest **252/252**（+15 三关验收）/ pytest **49/49**（+4 Agent 挑战回合）/ **product-challenges-test 真实鼠标 PASS**（命中/失败重试匹配/超预算反馈/共享预算 19→18/0 错误）/ render+physics+formula+lab 四脚本回归 PASS · build ✓。**坑**：React 切桌面时 kind 与 level 必须原子更新（渲染竞态 undefined.toFixed 整页崩）；uvicorn 常驻后改 engine_server 需重启后端；vite 把 node:fs 静态图污染浏览器包——类型+常量放 levels.ts、内核留 kernel.ts；Mimosa 会把名为 exec 的回调参数判为命令注入（纯类型回调改名 runAttempt）
- 待验证（开放）：拖拽直接反写（当前为滑杆+按钮发射）、Worker 预览层、WebGL 3D 视图渲染细节、真实 Qwen

v0.6 补充（2026-10-07，魔搭部署实跑与云侧限制确诊）：

- [x] **ms-studio-deploy 技能落地**：`npx skills add` 注册表无此技能（npm skills ≠ 魔搭技能中心）——从官方 GitHub `modelscope/modelscope-skills` 装入 `~/.agents/skills/ms-studio-deploy/`；按 10 步 OpenAPI 工作流完成：Studio `Jack0702/paper2lab`（Docker 型/免费 2v-cpu-8g/已公开 https://jack0702-paper2lab.ms.show）创建、git 推送（--allow-unrelated-histories+README 冲突 keep-ours）、deploy、build/run 日志诊断多轮
- [x] **云侧 Bug 修复链**（线上 504 根因逐层剥）：① 首次构建缺 bundle（Dockerfile.smoke 未产出 engine_once.mjs）② YAML step 名裸冒号 ③ tsx 冷启动 >300s（弱 CPU）→ esbuild 预打包 `scripts/engine_once.mjs`+`engine_server.bundle.mjs` ④ serverless 内联执行路径（`engine_api.execute` 优先 spawn 短命 `engine_once.mjs`，进程生命周期完全在 HTTP 调用内——**本地容器模拟 FC 冻结 130s 后 0.12s 即答**）⑤ `engine_bridge._guard()` 修 asyncio.Lock 跨事件循环绑定
- [x] **线上已验证**：SPA 200 · /api/ready ready:true（storage=/mnt/workspace）· CI 三段 Actions 全绿（PR #20 合并）
- [x] **已解决（2026-10-08 确诊非平台限制，是镜像缺件）**：所谓"FC 调度不保证"实为 ①最终镜像缺 engine_once.mjs（execute 被迫走 stdio 桥）②最终镜像缺 vendored MuJoCo scenes（**两个** engine bundle 导入期 findScenesDir 即崩，stderr 只剩 'Node.js v22' 尾巴误导诊断）。修复后云端实测：execute sin(1)=0.8415 / 1.5s、mujoco 100 步 / 1.7s、ready 全绿、真实模型全回合完成。

v0.1 升级轮补充②（2026-10-07④，真实论文 PDF 验收语料，PR #42）：

- [x] **#24 五收口**：四篇 tectonic 真排版论文（捕食-猎物/阻尼振子/指数衰减拟合/正弦标定）+ 真实 Docling dump 入库 fixtures；管线补缺——normalizeDocling 保留结构化 table{columns,rows}（真实 docling 表非 text）、parseDataPairs 读 table.rows（表头 NaN 跳过）；`src/skills/realPdfs.test.ts` 每类两篇**零合成全链**（路由→绑定→论文 latex 含尾标点原样编译真算：LV 周期/阻尼衰减/拟合 RMSE<0.1）；`test_real_pdf_corpus.py` real_docling 漂移守卫（重解析逐字比对，本地 79.9s 过，快集按名排除）
- 测试基线：pytest **100/100** · vitest **283/283**

v0.1 升级轮补充③（2026-10-08，用户报告修复：解析慢+离线 Errno 101，PR #43）：

- [x] **离线解析**：docling 冷缓存首解析上 HF Hub（无网即 `ConnectError [Errno 101] …snapshot not found`）——`scripts/download_docling_models.py` 一次性预下载（`--artifacts` 便携目录同时钉 DOCLING_ARTIFACTS_PATH+HF_HOME，docling 原生与 Hub 两类模型家族都落盘）；`PAPER2LAB_DOCLING_OFFLINE=1` 在任何 docling 导入前置 HF_HUB_OFFLINE=1；Docker 构建期烘焙 /opt/docling-models（ready 工件检查可满足）
- [x] **解析提速**：#38 的每 PDF 全新进程令模型每次重载——`ingest_worker` 改**常驻行协议 warm worker**（converter 加载一次复用，首载后秒级）；per-job 超时仍整体 KILL（可杀不丢）+ 自愈重启 + 响应 id 失配换新；实测 HF_HUB_OFFLINE+暖缓存下真实论文离线解析 13 items/2 公式
- 测试基线：pytest **102/102** · vitest **283/283**（warm 同 pid 复用/杀后换新/crash 尾巴入消息）

v0.1 升级轮补充④（2026-10-08②，用户报告云侧实测收敛：离线解析全通，3 个 hotfix）：

- [x] **云侧解析三连修（构建日志逐层确诊）**：① 烘焙层早于 papers COPY 且 `||` 回退掩盖失败（假 MODELS_WARM 带空缓存上线）→ warm PDF 随层 COPY + 硬失败 + 两模式断言 `models--docling-project--*` 落盘；② DOCLING_ARTIFACTS_PATH 手工布局找不到 hub 模型 → **单机制 HF_HOME**（本机验证 3 模型族全落目标目录）；③ docling-ibm-models 依赖非 headless opencv，slim 镜像缺 libxcb/libgl → apt 层补齐
- [x] **云端终验**：部署实例上传真实论文 fit-sine-fit.pdf → **离线完整解析 done**（14 items/1 公式/表格 5 数据行）——用户报告的 Errno 101 在云侧与本机（download_docling_models.py）两条路径均已消除
- 测试基线：pytest **103/103** · vitest **283/283**；魔搭 main=760cbb6 Running

v0.1 升级轮补充⑤（2026-10-08③，真实供应商实配验证：discovery-api × qwen3.8-27b，PR #44）：

- [x] **真实模型服务端执行闭环（此前"未验证"项）**：用户提供 OpenAI 兼容端点 discovery-api.intern-ai.org.cn/v1 + qwen3.8-27b（推理型；chat/流式/tool_calls 实测全支持）。真实回合端到端：backend(openai/qwen3.8-27b)→模型自主 tool call→服务端经引擎桥真算（formula a×2：peak 2.998≈2×1.5，integral 9.85→19.69 精确 2×，comparison 携带真 runId）→结果回填续跑→done。凭据仅 Studio secrets/env，未入源码
- [x] `agentscope_stream` 增 server_execute：execution:"server" 时模型工具调用直接走引擎桥（计划按 #32 注册），ExternalExecutionResultEvent 回填同一 agent 续跑；浏览器 Lane B 行为不变
- [x] 实配修出三真 bug：①AgentScope 2.0.9 权限引擎先读 `is_read_only` 类属性——缺 class attr 第一个真实回合即崩；②真实模型失败步骤无界重试 ~40 轮→PAPER2LAB_AGENT_MAX_ROUNDS=6 显式上限；③推理型模型终答只在 reasoning_content→提示要求纯文本终答+兜底 observation（真实 run 数字，标注"模型未给出文字结论"）
- 魔搭 Studio 已配置 5 个 provider secrets（PROVIDER/BASE_URL/API_KEY/MODEL/TIMEOUT），随部署注入容器

v0.1 升级轮补充⑥（2026-10-08④，云侧引擎修复 + 真实 AI 云端上线，PR #44 + 3 hotfix commit）：

- [x] **云侧引擎全通（此前误诊为 FC 平台限制）**：构建/运行日志逐层确诊——①最终镜像漏 COPY engine_once.mjs（云 execute 落入 stdio 桥→冻结饿死）②漏 vendored MuJoCo scenes：engine bundle 导入期 findScenesDir 抛错即崩，stderr 尾巴只剩 Node 崩溃横幅误导为"调度问题"。修复（engine_once.mjs + scripts/scenes 随镜像）：云端 execute **sin(1)=0.8415/1.5s**、**mujoco 月球重力 100 步/1.7s**、/api/ready 全绿（engine booted:true）
- [x] **真实 AI 云端上线**：Studio secrets 配置 provider/openai 兼容 discovery-api.intern-ai.org.cn/v1 + qwen3.8-27b；云端 /api/agent/health backend=agentscope-openai·aiVerified=true；**云侧真实模型完整回合**：模型自主 tool call→引擎真算（peak 2.998≈2×1.5、integral 9.85→19.69 精确 2×、comparison 真 runId）→canvas_apply 诚实拒绝→done+observation
- PR #44 服务端执行闭环 + AgentScope 2.0.9 三兼容修复（is_read_only 类属性/无界重试上限 6/推理模型兜底 observation）

v0.1 升级轮补充⑦（2026-10-08⑤，解析进度可视化，PR #45）：

- [x] **解析进度 UX（用户报告：20-60s 静态转圈读作卡死）**：worker 行协议增中间 stage 通知（warming=模型加载/parsing=转换），状态端点增 stage/elapsedMs/queueDepth；Home 分阶段解析卡（排队中·前面 N 个/模型加载·首次约 30-60s/解析中·版面→公式→表格·Ns 实时秒表）+ 三速扫描条（宽度非百分比——解析非线性可测，动效示活文字示真）；upload.ts onProgress 流式回传 + timeout 终态明确报错 + 404=任务丢失即报 + **轮询失败不再重传整个 PDF**（旧代码解析中途失联会重试 POST——一张纸最多解析 3 次）。实测时间线：首次 warming@2.0s→parsing@2.2s→done@48.7s；暖机 parsing@0→done@21.3s
- 测试基线：pytest **106/106** · vitest **287/287**

v0.1 升级轮补充⑧（2026-10-08⑥，解析任务 latest-wins + 刷新重连，PR #46）：

- [x] **latest-wins（用户报告：刷新重试效果差——重试排在自己卡住的任务后）**：POST /api/ingest 增 clientId（每标签页稳定）；同页新上传**立即取代**旧任务（排队中→superseded 终态；卡住运行中→杀 warm worker 释放槽位，run() 不得覆写 superseded 真相）；他页任务免疫。客户端 sessionStorage 记 lastJob——**刷新后重连**仍在跑的最新任务（文件名·阶段·秒表），完成提示重新拖入；superseded/timeout/404 三终态明确报错
- [x] **根治跨事件循环 bug**：warm worker 原模块级单例把子进程状态带过已关闭 loop（lifespan 关停崩 'Event loop is closed'）——改随 app 生命周期（lifespan 建停/app.state 持有/headless fallback）
- 测试基线：pytest **108/108** · vitest **287/287**

v0.1 升级轮补充⑨（2026-10-08⑦，PDF 先展示 + 真路由 bug，PR #47）：

- [x] **PDF 先展示（目标明示项）**：uploadFlow——blob URL 文件落地第一刻创建（解析前）；流 settle 不 throw（失败态保留原文 URL）；重试复用同一 URL 零泄漏；Home 解析中/失败态渲染原生 PDF 预览 iframe + 真实错误 + 重试解析按钮（解析失败绝不阻断原文访问）
- [x] **修真 bug（旧测试空过掩盖）**：ODE_LATEX[0] `\\dot\{` 不容空格——真实 Docling 输出 `\\dot { x }` 带空格，捕食-猎物真实论文一直误路由 formula；PR #42 两处早退守卫（if adapter!=ode return）是空过——改硬断言
- 失败路径验证（两真实论文 fixture）：A(crash)→URL 保留→重试→decision=ode；B(timeout)→原文可用→重试→fit 表格；404 同样保留；后端 retry-after-error（error 带 stderr→同 clientId 重传→done）
- 测试基线：pytest **109/109** · vitest **290/290**

v0.1 升级轮补充⑩（2026-10-09，用户报告"解析依旧失败"确诊：扫描件 OCR 两连修，PR #48 + hotfix）：

- [x] **确诊链**：构造扫描式 PDF（纯图片页）→ 云端 done/**0 items** vs 本地 2 items → 0-items 守卫上线（诚实报错）→ 内嵌最小 RapidOCR 探针 → **ImportError: onnxruntime is not installed**——RapidOCR 默认 onnxruntime 引擎从未在 requirements；本地能跑仅因 docling 回退 torch 引擎
- [x] **修**：requirements 增 onnxruntime>=1.17,<2；download 脚本预热 OCR 模型族（rapidocr 自管 site-packages/models，**不走 HF_HOME**——此前烘焙只覆盖 HF 家族）；Dockerfile 烘焙后断言 rapidocr models 非空；ingest_core 0 页/0 条目双守卫（**不再假 done**）+ OCR 探针把真实异常写进错误消息（云端静默失败从此一眼定位）
- [x] **云端终验**：扫描件 done@55s / **2 items**（OCR 提取出图中文字）；数字 PDF 同部署回归 done@17s / 14 items / 1 公式
- 测试基线：pytest 109/109 · vitest 290/290

v0.1 升级轮补充⑪（2026-10-10，启动预热：首击引擎 23s→1s，PR #49）：

- [x] **性能实测定位**：数字 PDF 云端解析 10s（烘焙已生效非瓶颈）；真慢在 ①冷启动后第一次引擎请求 ~23s（node+bundle+cortex 冷导入）②第一次解析付 docling 模型加载（warming 30-60s）
- [x] **lifespan 后台预热**（非阻塞/预算受限/失败静默）：docling 走 warm worker 真实微解析 + 引擎走 once-runner formula.plot 微执行；测试门（PAPER2LAB_TEST_CONVERT / DISABLE_STARTUP_WARMUP，conftest 全局关——否则每测试实例重载模型套件爬行）
- [x] **云端复验（部署后）**：首引擎请求 **1.07s**（此前 ~23s）；首解析直接进 parsing 无 warming（65s 完成含真实解析），第二张 **6s**/14 items
- 测试基线：pytest 109/109（时长不变）

v0.1 升级轮补充⑫（2026-10-13，VLM 快速理解：原生多模态解析路径，秒级替代慢 Docling）：

- [x] **能力实测先行**：qwen3.8-27b 元数据 `input_modalities=[text,image]`，base64 PNG 视觉读取、视觉+tool_calls 组合全部实测通过——直接用原生模型读论文页面，绕开 CPU 版面+公式+OCR 管线
- [x] **`server/vlm_parse.py` fast-path**：pypdfium2 渲染页→PNG（≈150dpi，0.05s/页，纯 wheel 无系统依赖）→ 4 并发逐页视觉提取（JSON prompt：text/formula LaTeX/table）→ 归一化 IngestedDoc（engine `vlm`、doclingVersion `<model>@fast-path`、页面级锚点 + AI 来源明示）；模型输出防御性解析（围栏/顶层数组/截断修复/逐对象兜底）+ 单页重试一次 + 双败带页号显式失败；管道表→结构化 `table{columns,rows}`（与 Docling 同构，fit 绑定走结构化路径）
- [x] **`/api/ingest` mode 参数**（docling 精读定位 | vlm 快速理解）：VLM 分支不占 docling 单进程槽位；provider 仅 env 层解析（复用 agent_provider 单源 + validate_base_url SSRF 门 + follow_redirects=False），未配置→显式可操作错误（**绝不静默回退 docling**）；job 携带 mode/stage(vlm-reading)
- [x] **前端模式选择**：Home 双卡片「⚡快速理解（AI 读图·秒级）/ 🔍精读定位（Docling·字符级锚点）」默认快速理解（用户核心痛点是慢）；vlm-reading 阶段文案；桌面顶栏「AI 视觉提取（页面级锚点）」来源标识；upload.ts/uploadFlow 透传 mode
- [x] **顺带修两个真 bug**：① executor `compileExpr` 编译整条 `y=…`（Equal 节点）得恒 0 曲线——现在字符串先 parse、Equal 取 RHS（与 analyzeFormula 同语义；VLM 公式带 LHS 首次踩中）；② normalizeDocling 把后端 `engine:"vlm"` 覆写成 `'docling'`——改为透传（类型收窄为 `'docling'|'vlm'`）
- [x] **全量跑暴露第三个潜伏 bug**：PR #38 误删 `job.persist_doc()`——文档自 #38 起从未落盘（`/api/document/{id}` 404、重启丢 result），CI 的 `-k "not real_docling"` 恰好把守着它的 lifecycle 测试排除在外；恢复调用后 real_docling lifecycle 复绿
- [x] **真模型实测（本地）**：ode-lotka-volterra **2.6-5.8s**/13 items（`\dot{x}=x-xy`、初值 x(0)=2/y(0)=0.5 全对）· fit-sine-fit **2.9-3.3s**/14 items（`y=a\sin(bx)` + 5 行结构化数据表）——vs Docling 云端 10-65s
- [x] **VLM fixtures 入库**（真实模型输出 `src/ingest/fixtures/*.vlm.json`）：vitest 验收 VLM 提取走**同一条**路由→绑定→真算链（ok-ode 周期闭环 / ok-fit 5 数据点）；pytest 16 项（输出形状容差/管道表/SSRF 门/编排重试/端点 mode 路由/无 provider 显式报错）
- 测试基线：pytest **127/127 全量**（快速集 125 + real_docling 2）· vitest **292/292** · tsc 0 错；VLM 登记常量入审计 G 节

v0.1 升级轮补充⑬（2026-10-14，架构缺陷修正轮：五项按性价比落地）：

- [x] **VLM 页数上限截断显式化 → 审阅后改判拒绝**：>24 页论文最初改为静默截断+显式标记（truncatedAfterPage + 桌面徽章），Copilot/Codex 审阅一致指出「部分语料当成功交付」本质不变——**最终方案：超限直接拒绝**（`VLMLimitError`，错误消息引导「精读定位」，零 provider 调用；pypdf 造 26 页 PDF 断言拒绝+引导）；Home 错误面板对超限/无 provider 两类错误都给一键切换提示
- [x] **latest-wins 真取消 VLM 任务**：原 supersede 只杀 docling warm worker，运行中的 VLM gather 不受影响、继续烧 provider token 到自然结束——现 run() 协程登记进 `_running_tasks`，supersede 时 `task.cancel()`（CancelledError 分支静默落定不覆写真值），docling 路径额外保留杀 worker；测试证明 CancelledError 真正到达协程
- [x] **可选 API token 鉴权**：`PAPER2LAB_API_TOKEN`（未设=本地开发全开放，行为不变）设置后所有 `/api/*`（health/ready 除外）要求 Bearer/X-API-Token——自托管与网关配置失误不再裸奔 provider 计费解析/磁盘写入/引擎执行；前端 `src/ingest/apiAuth.ts`（VITE_ 构建期或 localStorage 运行期粘贴）统一注入五个调用点（upload/agentBridge/adapterRouter/ChallengesLab/precomputedRuns）；测试覆盖 401/放行/X-API-Token/未设开放
- [x] **每日全量 CI workflow**（`ci-daily.yml`，03:30 北京 + 手动触发）：跑**含 real_docling 的完整 pytest** + vitest + tsc + build——per-PR CI 的 `-k "not real_docling"` 排除正是 #38 persist_doc 误删存活 5 天的结构性原因，此 job 是守卫回归的后备
- [x] **桌面级懒加载拆包**：App.tsx 四桌面 React.lazy + Suspense（Kakeya/Physics/Challenges/PaperDesk），Home 的路由器改动态 import（cortex 不在首屏路径）——首屏 chunk **9.7MB→1.9MB**（cortex 3.5M/tldraw 2.9M/executor 828K/三 Lab 全部按需）

v0.1 升级轮补充⑮（2026-10-15②，审阅修复轮：Copilot+Codex 对 PR #50 的 findings 逐条处置）：

- [x] **引擎 bundle 未随 compileExpr 修复重建（Codex P1，生产级）**：`engine_once.mjs`/`engine_server.bundle.mjs` 是 esbuild 产物（engine_api/bridge 优先使用），10-08 构建早于 Equal-RHS 修复——生产引擎对 `y = …` latex 仍恒 0 曲线；按 Dockerfile 同命令重建两个 bundle，once-runner 真跑 Equal-latex 验证 peak≈2
- [x] **docId 毫秒碰撞 → uuid**（两机器人一致 P1）：并发同毫秒 VLM 任务会写同一 `doc-{id}.json` 互覆——改 `vlm-{uuid4[:12]}` + 唯一性断言
- [x] **进程级 VLM 准入闸**（review P2）：per-job Semaphore(4) 不管全进程——N 并发上传曾可同时发 4N 路 provider 调用；新增共享 `_vlm_jobs_guard`（`PAPER2LAB_MAX_VLM_JOBS` 默认 2，循环亲和同 _ingest_guard），超出的 VLM 任务排队（queued）等槽位
- [x] **queued-supersede 复活 bug（连带修复，docling 路径同形存量）**：排队中被取代的任务稍后获得槽位会把状态覆写回 running 并照做工作——queued 分支也 `task.cancel()`
- [x] **vlmPdfs.test 硬断言 adapter**（Copilot Medium）：早退守卫令路由回归时空过——改 `expect(d.adapter).toBe('formula')`
- [x] **已在 754e76c 修复、审阅时已过时的 findings**（审的是合并前旧提交）：supersede 真取消（task.cancel + CancelledError 静默落定）、VLM 任务不再误杀无关 docling worker（mode 隔离）——PR 线程回复处置结论
- 测试基线：pytest 快速集 **133**（+3：准入闸/排队取消/超限拒绝引导）· vitest 292

v0.1 升级轮补充⑯（2026-10-15③，paper→model Slice A+B：论文理解 → 引擎构建数学模型）：

- [x] **调研落盘 `docs/research/paper-to-model-survey.md`**：四仓实读（Paper2Code 三段式/SciCode 证明 LLM 直写科学代码仅 10.8%/marimo reactive/PhET 机制）+ 数据流四断层诊断（无理解对象/四抽屉建模/参数脱钩/状态散落）+ 四层方案（Comprehension→Construction→Live Params→Understanding）
- [x] **L1 理解层 `src/skills/paperSpec.ts`**：`PaperModelSpec`（问题/量分类 state·parameter·observable·independent/方程分类 governing·initial·definition/命题 claims）确定性提取——初值与名义参数全部 PAPER 原文数字（`x(0)=2`、`β = 0.4` Unicode 希腊映射回宏名），每项带锚点；`governingSystem`/`initialsOf`/`nominalParams` 供下游消费
- [x] **L2 物化层 `model.build`/`model.solve` 技能**（registry+executor）：任意 **N 态** RK4（ode.phase 的 2 态上限突破）——论文 latex 右端逐条编译（初值处有限性验证；发散显式报错）；`model.solved` Run 携带全态 series/min-max/首态周期；fork 只改参数不改论文初值（applyForkChanges 白名单门）
- [x] **两个 Cortex 真坑修复**：① greek 宏常数折叠——`\gamma` 在表达式中解析为欧拉常数 0.5772×（β 疫情模型 γ 被静默换成常数！）→ 声明符号宏统一改写 `\mathrm{}` 形式；② 单字母常数碰撞（e/i/phi…）→ MathJSON 树统一 v 重命名（sanitizeSymbols）+ sanitizedEnv 绑定
- [x] **第三篇真论文验收 `ode-sir-three-state.pdf`**（tectonic 3 态 SIR）：真 Docling fixture（3 公式/初值/名义参数句）→ vitest 全链**零手写数字**（routing ok-ode → spec 3 态 → nominalParams{β:0.4,γ:0.1} → build 空闲参数为零 → solve **S+I+R 守恒 <1e-9** / I 峰 0.406=Kermack–McKendrick / 燃尽 S 终 2% → fork β↓0.05 阈值下无爆发 + parentRunId 血缘）
- [x] **理解卡面板 `src/desk/SpecPanel.tsx`**：顶栏「🧠 理解卡」→ 问题/方程（分类标签）/量表（论文给定值）/命题（PAPER）→「⚙ 构建模型并求解」走统一 executeSkill → CALCULATED 徽章（engine·ms·runId）+ 每态 min/max/终值表 + FINITE-SCALE 声明；缺初值时诚实拒绝（「模型不猜造」）；`scripts/spec-panel-test.mjs` 真浏览器全链 PASS（6 方程/3 态行/0 console 错误）
- [x] ExperimentKind 增 `model.compiled`/`model.solved`；COMPUTE_BY_KIND/inputFromSpec/FORMAL_SKILLS 全接
- 测试基线：vitest **299/299**（+7：paperSpec 4 + SIR 3）· tsc 0 · build ✓；`MODEL_SOLVE_STEPS=2400` 登记入审计

v0.3 首切片（2026-10-28，#51 推荐首个实现 Slice 全项落地）：

- [x] **issue #51 七条断言逐条核实**（全部属实）：有限 Adapter 路由✓ / claims.source 缺失✓ / odeSystemOf 只取前 2 态✓ / RunView3D 双处订阅全局 tubesRunCell+pPacking✓ / VLM 页级锚点✓ / `_CONTEXT_BUDGETS` 400/500/300/500✓ / 历史时间差以 §10 补充⑯为最新现状✓
- [x] **P0-D Slice 1+2：3D per-experiment 状态**——新增 `src/desk/run3dStore.ts`（每张 p2l-3d 实验纸独立 params/kakeya.generate+measure 双 run/preview/错误态）；`RunView3D` 双处全局订阅全部改为按 shapeId 读各自实验；拖拽预览为 presentation-only（向心仿射插值，同 challenge offsets 语义）、释放 commit 才经统一 executeSkill 产**该实验自己的**双 run；`grow-3d` 每次点击长出**新独立实验纸**（seed 自当前全局快照，不再限制单张）；回归测试 5 项（两纸不同 packing→不同 runId+不同几何/预览不改已提交 run/commit 不碰全局 Runtime/失败诚实 error 不造假 run/PlayPlan 门）钉死旧混淆不再回归
- [x] **P0-B/E Slice 3：两篇非同模板 ODE 真论文**——`ode-michaelis-menten.pdf`（4 态酶动力学、κ/λ/μ 希腊速率、可逆反应）与 `ode-spring-params.pdf`（2 态、符号系数 k/c 论文原文给定）；tectonic 排版+真 Docling fixture；全链零手写数字：路由→spec（4/2 态、初值、名义参数）→build→solve→**论文自述守恒律**（MM：E+C 与 S+C+P 双守恒 <1e-9、P 单调上升；弹簧：幅值衰减 <0.45×、衰减信号 period0=null 为诚实行为）；ODE 语料扩至 5 篇（2/2/3/4 态 × 0/内联/希腊/拉丁参数互不同模板）
- [x] **理解卡 plotted Run**：SpecPanel 内嵌 SVG 时间序列（每点即 model.solved Run 数据，无第二计算路径）+ 命题锚点精度标签
- [x] **P0-A Slice 4：锚点精度分级**——`anchorPrecision: 'region'|'page'` 全链（vlm_parse 服务端打 page 标、doclingSchema 透传、docling 默认 region）；claims 绑定源句 item（`source`+精度），未绑定⇒`ambiguous`（红色虚线标签），VLM 页级锚点永不冒充 region bbox；µ(U+00B5)/ϕ/ϰ 等 docling 变体字形映射修复
- [x] 测试基线：vitest **307/307**（+8）· pytest VLM 面 22/22 · tsc 0 · build ✓ · product-lab（per-experiment 拖拽写回+0 错误）与 spec-panel（6 方程/3 态/CALCULATED）双产品脚本 PASS；Chromium `--no-proxy-server`（系统代理故障不再污染产品证据）

v0.4（2026-10-07②，真实可玩闭环轮：#21–#24，PR #25/#26/#27/#28）：

- [x] **#21 管束评分科学漏洞修复**：出单位立方体不再可能降分——操纵语义改为"每簇向立方体中心凸插值"（构造性合法，凸组合保管段在 [0,1]³），`violations>0 ⇒ 0 分不达标`（防御层）；实测复现：全 1 由假通关 0.031467 改为 0.290509 未达标；预算按实测诚实地形重定 0.28（非单调——半收拢 0.2704 优于全粘 0.2905，真谜题）
- [x] **#22 PaperBinding 绑定链 + 路由三态**：`src/skills/paperBinding.ts`（锚点→问题→方程与变量单位→条件→可操作对象→观测量→引擎视图；`odeSystemOf` 从论文 latex 提取二状态系统、`parseDataPairs` 从表格提取 (x,y) 对——缺什么问什么，不发明）；adapterRouter 返回 ok / needs-info（缺初值/缺第二条方程→具体问题）/ out-of-scope（无方程无数据→明确拒绝不套 Demo）；PaperDesk 固定 Kakeya 3D 按钮仅 ok+kakeya 可见；LLM 路由收紧 index-only
- [x] **#23 性能**：runtime `AbortToken`（新一代失效在途可见，sweep 逐档让位/voxel 派发前让位）+ **惰性 async cell**（无观察者停车 pending，订阅/get 唤醒，退订后参数变化不再计算）；`kakeya.sweep` 按需开关（默认关=零 Worker 流量）；formula 拖动契约 MOVE=预览（同内核 61 采样 `formula.preview` 非证据）/UP=正式（361 统一执行器），Direct Geometry 反拖同契约；无头 P95 见 `scripts/perf_probe.ts`（parse 1.07 / preview 0.05 / exact 0.67 / kakeya res48 10.8ms——证实长等待源于排队竞争而非内核）
- [x] **#24 三类论文驱动交互**：**ODE**——新技能 `ode.phase`（generic2：论文 latex 右端 Cortex 编译 + RK4 2400 步；状态可负——阻尼振子是物理不是种群；周期=信号中位线上升过零中位数，LV 绕平衡点非零点）+ `odePhaseStore`（拖预览/释放精确/历史逐次记录/latest-wins）+ `PhasePlaneChart`（向量场+可拖初值+轨迹+时间曲线**同一 Run**）+ tldraw `p2l-ode` 形状 + PaperDesk ok/ode 长出；**拟合**——fit 绑定携带论文数据点，实验纸图表叠朱砂散点+RMSE（读 Run 采样曲线插值，非第二计算通道）；**约束几何**=#21 修复即该类交付。每类两篇条件不同的论文 fixture 验证（捕食-猎物/阻尼振子；衰减/正弦+各自数据表）
- [x] **Agent 读历史**：planner 增 `history: RunSummary[]`——重复配置的 plan 标题引用历史同参数 Run（含其 |⋃T|），动作白名单不变；PaperModeNode 从 listExperimentRuns 供给
- [x] **引擎可见性回归修复**（cd41452 遗留）：once-runner 执行的 Run 现追加进共享 run log，长驻引擎 `runs` op 列表前从 log 重同步（runId 去重幂等）——内联执行不再对 run-history 不可见；server pytest 更新为诚实通关配置
- 验证：vitest **277/277**（+21）· pytest 49/49（清态）· tsc · build；浏览器交互验收按当前迭代约束记为待验证

v0.1 升级轮（2026-10-07③，六组问题 #29–#34，PR #35/#36/#37 已合并）：

- [x] **#29 统一 AI 接入（PR #35）**：`server/agent_provider.py` env-only provider/base_url/model/key/timeout 单点解析（显式 `PAPER2LAB_AGENT_PROVIDER` 优先；OpenAI 兼容走 AgentScope `OpenAIChatModel+OpenAICredential(base_url)`，DashScope 保留）；SSRF 守卫拒环回/私网/保留地址；能力探测区分 chat/tool_calls/stream；**SOP 回退永远显式**——AI 回合首事件 `backend`（provider/model/aiVerified），失败前零事件则 `sop_fallback(reason)`，中途失败不回退；前端零密钥（llmPlanner 删 VITE_ 路径、路由辅助走 `/api/agent/route`）；AgentPhaseStrip 常驻 provider 芯片与 ⚠回退标记。真实供应商回合无凭据=未验证（不假装接通）
- [x] **#30 工具面单一来源（PR #36）**：`scientific_execute` 模型 schema 从引擎桥 skills 面（真 Skill Registry）生成——六桌面 enum + 技能清单进描述；载荷**无 implemented 字段，在列即可执行**；桥不可达→保守回退面；Agent 上下文四段预算（paper/formulas/current/history，历史最新 6 条倒序）替代 1200 字符硬截断；引擎桥**循环亲和**修复（子进程绑启动循环，pytest 每测试新循环时 stop+重启——修跨循环 ping 永不解析）
- [x] **#31 首批（PR #37）**：`/api/ready` 引擎检查升级**真 ping**（僵尸=不就绪带 pingError；`PAPER2LAB_READY_ENGINE_PING=0` 冷路径开关）；`PAPER2LAB_REQUIRE_MODEL_ARTIFACTS=1` 时 Docling 工件缺失=不就绪（离线不静默下载）；engine_persist JSONL **逐行容错**（崩溃半行只丢自己）；Docker 依赖核实已含 engine_persist/once.ts
- [x] **#31 余项（PR #38）**：docling 解析移入**可终止 worker 进程**（超时 kill+wait 真实释放槽位；queued/running/timeout/error 状态真实化；thread 模式保留）；引擎 execute 增 **requestId 幂等**（in-flight 并入/失败也缓存不重跑）；boot ping 10s×2 次重试（冻结子进程快速换新）；_ingest_lock 循环亲和+超时活读
- [x] **#32（PR #39）**：executor 门升级为**只认注册 PlayPlan**（planCoversSkill 同技能/别名/伴随集；registerPlanFromJson 首注册幂等）；引擎 plan op + execute/agent_steps 内联计划；once argv[6] 计划槽；全部测试夹具/CI 冒烟换真计划
- [x] **#33（PR #40）**：物理页录制器——live wasm 会话（qpos0/qvel0/逐步拖拽力事件）即导出 Run（source='live-session'，playback 直接回放用户轨迹）；场景切换释放旧 GPU 资源+参数重置为新模型默认；Desk3DOverlay 每视图独立订阅（不再全局单 Run 喂所有 3D 纸）
- [x] **#34（PR #41）**：验收电池（参数→新 Run/Fork-Compare-Trace HTTP/6 并发/重试不重跑/重启恢复，真 app+引擎）+ 服务端 P95 基线（cold 349ms/warm p95 489ms/缓存重试 p95 1ms/隔离 ingest p95 87ms）；**修复 once-runner 两真 bug**：argv 槽位历史错位（parentRunId 血缘从未生效）与跨调用不 restoreRuns（fork 找不到源 Run）
- 测试基线：pytest **100/100** · vitest **279/279**；工作树 9 个未跟踪草稿（10-06 会话遗留）未引用未删除；浏览器渲染 P95/真实指针验收待验证（无 GUI 约束）

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
