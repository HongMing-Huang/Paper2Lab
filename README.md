# Paper2Lab

Paper2Lab 的产品目标是：让 AI 把真实数学论文中的可计算对象，变成可以进入、操控、挑战和持续研究的数学世界。用户既能直观探索，也能返回原公式、条件、论文来源与实验历史。

当前代码以 Reactive Paper、专用实验和论文桌面为基础；生成式游戏与新DSH主链按Linear M1–M4推进，不能把现有展示资产称为整产品已完成。四个里程碑依次交付：真实Agent实验、可继续研究空间（C1）、生成式游戏（E1）、跨模型与可靠性（E2）。

以下是现有交互资产；三种模式共享同一份科学数据（AGENTS.md）：

- **Paper Mode**：打开即一张真实论文——问题、定理、公式、内嵌 Live Experiment。公式里的 δ/packing/N 是可拖动的芯片，拖动后右侧实验立即变化（拖动中 preview 低分辨率速算，松手 Worker 精算）。
- **Lab Canvas**：点"展开实验"，实验脱离纸面进入无限画布：自由移动/缩放/Fork/成组/对比；参数长在实验纸里（无 Dashboard）。
- **Microscope Mode**：双击 3D 进入沉浸模式，连续 zoom 1→ρ→δ/4——粗管渐隐、细管展开；Esc 返回。

**Hero Demo**：王虹 & Joshua Zahl《Volume estimates for unions of convex sets, and the Kakeya set conjecture in three dimensions》（arXiv:2502.17655）。

**Skills Agent**：问"如果方向数减少一半呢？"——不是文字回答，而是结构化 Action 流（fork → 改参 → 测量 → 对比 → 解释），画布自动长出第二张实验纸与对比卡。图表上点任何数据点可回溯到产生它的实验。

## 运行

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # 当前用例数量以实际输出为准
pnpm build
pnpm precompute   # C++17 -O3 -pthread 大尺度预计算（含 checksum）→ src/data/
```

## 计算架构

- **Kakeya 路径**：TypeScript 内核 + Comlink Web Worker（最低延迟）；大尺度用 C++ 预计算（参考 bojieli/kakeya-explainer，δ=1/1000 达数十亿格子不可实时）。
- **PythonScientificRuntime**：独立 Worker + CDN Pyodide（numpy/scipy、solveIVP 接口），为下一篇论文预留，不进 Kakeya 路径。
- **Reactive Runtime**：marimo 式依赖图（参数单一真源；拓扑序失效重算；状态机 idle→stale→computing→resolved→error）。
- **证据三标签**：PAPER（论文原文，pdf.js 定位高亮）/ CALCULATED（确定性程序）/ AI INFERENCE（仅解释）。有限尺度实验绝不表述为"证明了定理"。

调研报告（实际读源码 + 编译运行参考项目的 C++）：`docs/research/tech-survey.md`。开发约束见 **AGENTS.md**。

## 下一阶段开发

说“开发”即可按[开发循环](LOOP.md)读取[当前状态](STATE.md)，推进[整产品计划](PLAN.md)：论文库与来源 → Agent/检索和科学工具 → 可恢复研究空间 → 生成式数学世界 → 跨模型与发布前验收。人工问题按子项等待，独立工作继续；不把未回复视为授权。

先按[现有代码地图与整理边界](docs/development/codebase-map.md)理解真实调用链；可直接使用[完整开发启动prompt](DEVELOPMENT_PROMPT.md)；本机ZCode的启动/恢复、子Agent与权限说明见[ZCode启动loop](docs/development/zcode-loop.md)。

现有B0/S1/A1/D1/P1等已按旧消费者范围推进，最新状态见STATE，不能沿用历史计数。新DSH/Node路线见[产品合同](docs/development/product-experience-and-runtime.md)与[多窗口/Linear协议](docs/development/COORDINATION.md)。Linear已真实导入并回读，任务状态以P-CLI-3为准，STATE仅集成恢复点；可直接使用[分窗口prompt与工具规则](docs/development/WINDOW_PROMPTS.md)。loop不是后台服务，不能对三个窗口发送相同的自主选任务prompt。

白皮书与技术研究见[研究入口](docs/research/playable-mathematics-2026-11-02/README.md)；外部附件和源码已归入[工作树内材料](docs/research/playable-mathematics-2026-11-02/materials/README.md)，归档校验、缺失环境与历史PDF情况均有记录。[实施设计复审](docs/research/playable-mathematics-2026-11-02/implementation-review-20261105.md)列出10项问题、任务归属和验收门；具体审阅状态见STATE，研究通过不等于产品完成。
