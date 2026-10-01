# 硬编码数值审计清单（v4，2026-10-01）

> 规则（AGENTS.md §2.8）：除**论文原文（PAPER 引文）**与**明确标注的 seed/demo configuration** 外，最终用户可见的数值结果不得来自硬编码；一切数值与图必须可追溯到 ExperimentRun。

## A. 违规项（本轮修复）

| # | 位置 | 内容 | 处置 |
|---|---|---|---|
| A1 | `src/paper/wangZahl.ts:186`（WHATIFS w-halve-delta） | 叙述性数值 "~δ² 缩为 1/4 … ~×1/4"（预测结果写成数字） | 改写为定性描述（无具体数值），保留 AI INFERENCE 标签 |
| A2 | `PaperModeNode.tsx:73` / `nodes.tsx:303` | 徽章文案硬编码 "res 32³"（与 PREVIEW_RES 常量脱钩，改常量即撒谎） | 读取 `PREVIEW_RES` 常量插值 |
| A3 | `PaperModeNode.tsx:202` | "面积由 96² 栅格实测"（硬编码 GRID） | 读取 NeedleSweep 导出的 GRID 常量 |
| A4 | `NeedleSweep.tsx:128` | "/ 2.25"（盒面积字面量） | `box*box` 计算 |
| A5 | `nodes.tsx:474`（ObservationNode） | "原三角形 0.5774" 字面量 | `PERRON_TRIANGLE_AREA.toFixed(4)`（已有常量） |
| A6 | `ChartUnionNode` caption | "res 40³" 字面量 | 读取导出的 `SWEEP_RES` 常量 |
| A7 | `MicroscopeOverlay.tsx:102` | `fineDelta = 2**-6` 与 kakeyaGraph.fineTubes 的 `2**-6` 重复字面量 | 共享 `FINE_DELTA` 常量 |
| A8 | `ChartUnionNode` caption | "res 96–128³"（预计算 res 范围写死） | 由 precomputed JSON 派生 min/max |

## B. 允许项（分类依据）

| 类别 | 项 | 说明 |
|---|---|---|
| PAPER | Perron 三角形面积 1/√3、Theorem 引文、公式 | 论文数学事实/原文 |
| seed/demo config | `SEED=20250224`、`VIS_RES=16`、`PREVIEW_RES=32`、`SWEEP_RES=40`、`FINE_DELTA=2⁻⁶`、NeedleSweep `GRID/box/half`、ODE `y0=[1,0.5],t1=30,steps=240`、Fibonacci 方向数、packing∈[0,1] | 实验配置（非结果），集中声明且被 UI 引用 |
| 解释阈值 | ObservationNode regime 0.25/0.6、interpolate_packing 同 | AI_INFERENCE 启发式的配置阈值（非测量结果），已在审计中登记 |
| 论文知识库 | THEOREMS/CONCEPTS/EXPANSION_PACKS 文本 | PAPER/AI_INFERENCE 标注的非数值内容 |
| 离线预计算 | `src/data/kakeya-precomputed.json` | C++ 产物（参数+algorithmVersion+FNV-1a checksum），非手写 |

## C. 修复后约束

- 图表 datapoint 一律携带 `runId`（已实现）；Observation/Metric 显示 engine、durationMs、seed、runId（本轮 ExperimentRun 协议落地）。
- 新增数值必须来自：Worker 精算 / C++ 预计算 / Pyodide / PAPER 引文 / 登记的配置常量。

## D. v5 摄入闭环登记常量（配置/呈现类，非证据）

- `src/desk/explorerStore.ts`：`CURVE_SAMPLES = 361`（curveRun 采样密度；peak/∫ 均为真计算）。
- `src/desk/PaperDesk.tsx`：`PAPER_W = 560`、`PAPER_X/Y`（论文页渲染尺寸与初始摆位）。
- `src/formula/analyze.ts`：`TRIG_DOMAIN = [-7,7]`、`PLAIN_DOMAIN = [-5,5]`（绘图窗口）、
  `PARAM_DEFAULTS {default:1, min:-5, max:5, step:0.05}`（芯片初值与拖动步长）、
  `INDEPENDENT_PREFERENCE`（自变量识别顺序——分类规则，非数值）。
- `src/desk/FormulaChart.tsx`：`SERIES_COLORS`（曲线配色）。
- `server/ingest_core.py`：文本截断 600 字符（payload 上限）。
- 允许理由：均为 UI/采样配置，不冒充计算结果；所有用户可见数值（peak/∫/|⋃T| 等）仍一律来自 ExperimentRun。

## E. v6 Research Orchestrator 登记常量（配置/搜索策略类，非证据）

- `src/paper/challengeStore.ts`：`AGENT_PACKING_CANDIDATES = [1.0, 0.95, 0.9, 0.85, 0.8]`（Agent 挑战的 packing 搜索网格——策略与用户可用的参数空间完全相同，同一 worker/seed/res 逐点真算）。
- `src/desk/shapes.tsx`：Direct-Geometry 反演 `ITER=40` 二分步数与 `±16px` 命中半径（交互参数）。
- `server/agent.py`：SOP 回退的正则意图模式与默认 Qwen 模型名 `qwen-plus`（`PAPER2LAB_AGENT_MODEL` 可覆盖；凭据仅 env）。
- 允许理由：均为搜索/交互/回退配置，不产生或伪装任何用户可见测量值；所有可见数值仍 100% 来自 ExperimentRun。
