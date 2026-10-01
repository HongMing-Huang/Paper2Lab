# AGENTS.md — Paper2Lab 最高开发约束（v5）

> 本文件是整个项目的最高开发约束。**每次开发前必须先读本文件**；形成新的长期设计或技术决策后**立即更新本文件**。任何与本文件冲突的临时决定都不允许直接落地，必须先修订本文件。

---

## 0. 产品宪法（v3 重写，防止退化回卡片墙）

1. **Canvas 是"研究过程的历史"，不是静态知识图谱。**节点因用户的研究动作而生长；禁止一次性铺开十几张静态卡片。
2. **能转成实验的问题，Agent 必须创建实验，不能只回答文字。**Agent 输出结构化 Action（fork/change_parameter/measure/compare/observe），不是长文本。
3. **参数必须直接存在于公式和实验纸内部。**禁止独立 Dashboard 参数面板；δ、packing 是公式里可拖动的数字、是 3D 里可抓取的对象。
4. **科学节点必须 Reactive。**参数单一 source of truth；禁止在 UI 回调里手工同步 3D/图/文字。
5. **所有计算节点必须声明 Evidence 类型**：PAPER（论文原文）/ CALCULATED（本地确定性程序）/ AI INFERENCE（模型解释）。三者不可混用；AI 不产生数值；有限尺度实验不得表述为"证明了定理"。
6. **Kakeya P0 闭环**：`manipulate → compute → visualize → observe → fork → compare → trace`。每个环节必须有可演示的交互。
7. **交互优先级**：experiment > computation > visualization > explanation。

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

## 3. 计算架构（两条路径）

1. **Kakeya Hero Demo：TypeScript + Web Worker（Comlink RPC 封装）**——最低延迟。Skills：generateDirections / generateTubes / interpolatePacking / measureVoxelCover / measureMultiplicity / measureUnionVolume / runScaleSweep。
2. **大尺度：离线预计算 `scripts/precompute_kakeya.cpp`**——C++17 `-O3 -pthread`，输出 JSON 记录参数、算法版本、checksum。浏览器小尺度实时、大尺度读预计算（参考 bojieli/kakeya-explainer 的教训：δ=1/1000 达数十亿格子，不可傻算）。
3. **PythonScientificRuntime（为下一篇论文预留）**：独立 Worker + Comlink + Pyodide（numpy/scipy），接口先行（ensureNumpy/runPython/solveIVP 风格），**不得拖慢 Kakeya Demo**；Kakeya 路径禁止走 Pyodide。
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

## 11. 下一阶段（比赛迭代方向）

1. 视觉打磨：Paper Mode 双栏排版更精细、卡片入场动画、打印级排版细节；tldraw 生产 license（去水印）。
2. Microscope 的 ρ 尺度升级为论文级 tubelet 真模型（当前为 δ/2 视觉过渡层）。
3. web-llm 本地 Agent（语法约束 JSON）替换确定性 planner，Action 形状不变；Qwen 路由实配验证。
4. 摄入桌面增强：多公式 Playable 标记、分页论文 Shape、图表/表格 Anchor、experiment 的 preview/exact 双层（当前 formula.curve 单层即时计算）。
5. 3D 单管抓取（当前为整族 packing 拖动）与 tube 级反向同步。
