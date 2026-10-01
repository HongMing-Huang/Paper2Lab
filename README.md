# Paper2Lab — Reactive Paper

论文不再是 PDF，而是**可操作的研究对象**。三种模式共享同一份数据（AGENTS.md）：

- **Paper Mode**：打开即一张真实论文——问题、定理、公式、内嵌 Live Experiment。公式里的 δ/packing/N 是可拖动的芯片，拖动后右侧实验立即变化（拖动中 preview 低分辨率速算，松手 Worker 精算）。
- **Lab Canvas**：点"展开实验"，实验脱离纸面进入无限画布：自由移动/缩放/Fork/成组/对比；参数长在实验纸里（无 Dashboard）。
- **Microscope Mode**：双击 3D 进入沉浸模式，连续 zoom 1→ρ→δ/4——粗管渐隐、细管展开；Esc 返回。

**Hero Demo**：王虹 & Joshua Zahl《Volume estimates for unions of convex sets, and the Kakeya set conjecture in three dimensions》（arXiv:2502.17655）。

**Skills Agent**：问"如果方向数减少一半呢？"——不是文字回答，而是结构化 Action 流（fork → 改参 → 测量 → 对比 → 解释），画布自动长出第二张实验纸与对比卡。图表上点任何数据点可回溯到产生它的实验。

## 运行

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # 40 vitest
pnpm build
pnpm precompute   # C++17 -O3 -pthread 大尺度预计算（含 checksum）→ src/data/
```

## 计算架构

- **Kakeya 路径**：TypeScript 内核 + Comlink Web Worker（最低延迟）；大尺度用 C++ 预计算（参考 bojieli/kakeya-explainer，δ=1/1000 达数十亿格子不可实时）。
- **PythonScientificRuntime**：独立 Worker + CDN Pyodide（numpy/scipy、solveIVP 接口），为下一篇论文预留，不进 Kakeya 路径。
- **Reactive Runtime**：marimo 式依赖图（参数单一真源；拓扑序失效重算；状态机 idle→stale→computing→resolved→error）。
- **证据三标签**：PAPER（论文原文，pdf.js 定位高亮）/ CALCULATED（确定性程序）/ AI INFERENCE（仅解释）。有限尺度实验绝不表述为"证明了定理"。

调研报告（实际读源码 + 编译运行参考项目的 C++）：`docs/research/tech-survey.md`。开发约束见 **AGENTS.md**。
