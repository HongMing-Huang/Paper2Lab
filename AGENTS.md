# AGENTS.md — Paper2Lab 最高开发约束（v3）

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

react 19.3 / vite 7 / @xyflow/react 12.12 / three 0.186 + fiber 9.8 + drei 10.7 / @observablehq/plot 0.6.17 / mathlive 0.110 / pdfjs-dist 4.10（`?url` worker + convertToViewportRectangle）/ **comlink（新增）** / vitest 3。Pyodide 走 CDN v0.27.7 懒加载进 module worker（npm 打包在 Vite 下 loadPackage 失败——克隆 eqs/pyodide-vite 实证）。R3F 节点内嵌需 `nodrag/nowheel` + `eventPrefix="client"`。

## 7. 目录结构

```
AGENTS.md / README.md / docs/research/tech-survey.md
public/papers/wang-zahl-kakeya3d.pdf
scripts/precompute_kakeya.cpp        ← C++17 -O3 -pthread 大尺度预计算
src/
  runtime/     Reactive Runtime（状态机版）
  kakeya/      数学内核（directions/tubes/voxels3d/perron/metrics）
  workers/     voxel.worker（Comlink）、python.worker（Pyodide，接口）
  skills/      Skill Registry（11 canonical）+ planner（问题→Actions）
  canvas/      Paper Mode 页、Lab 节点、Microscope overlay、图表反向导航
  paper/       wangZahl 知识（引文+锚点）、kakeyaGraph（cell 图）、forks
  styles/paper.css
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

## 11. 下一阶段（比赛迭代方向）

1. 视觉打磨：Paper Mode 双栏排版更精细、卡片入场动画、打印级排版细节。
2. Microscope 的 ρ 尺度升级为论文级 tubelet 真模型（当前为 δ/2 视觉过渡层）。
3. web-llm 本地 Agent（语法约束 JSON）替换确定性 planner，Action 形状不变。
4. PythonScientificRuntime 首个真实用户：第二篇论文（ODE/统计）端到端。
5. 3D 单管抓取（当前为整族 packing 拖动）与 tube 级反向同步。
