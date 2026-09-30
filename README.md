# Paper2Lab — Reactive Paper

论文不再是 PDF，而是铺在无限科研桌面上的**活的研究对象**：公式、参数、实验、图表都是活的对象，改一个变量（如 δ），3D 几何、真实计算值、图表和解释同步变化。

**Hero Demo**：王虹 & Joshua Zahl《Volume estimates for unions of convex sets, and the Kakeya set conjecture in three dimensions》（arXiv:2502.17655，2025，证明三维 Kakeya 集猜想）。

## 运行

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # 数学内核 + Reactive Runtime 单测（vitest）
pnpm build        # 产出 dist/
pnpm precompute   # 重新生成离线预计算数据（可复现，seeded）
```

技术 Spike 路由：`http://localhost:5173/#spike`（组件组合验证页，保留供回溯）。

## 你能在纸面上做什么

- **拖参数**（PARAMETERS 卡）：δ（管半径）、packing（separated→sticky）、N（管数）、voxel 网格 —— 所有派生对象自动重算。
- **3D 实验**：Fibonacci 半球面 δ-分离方向生成 δ-tubes（React Three Fiber + InstancedMesh），可切 voxel 占用视图（按 multiplicity 着色）。
- **真实数字**：occupied volume / multiplicity 直方图 / max·avg multiplicity 由 Web Worker 有限尺度栅格化计算；更大尺度用离线脚本预计算（同一数学内核，可复现）。
- **2D Perron 树**：2^k 子三角形 α-重叠合并 + 单位针旋转动画，实测面积随参数变化。
- **回溯论文**：THEOREM 卡引用原文，点"在论文中定位此句"→ 论文页翻到对应位置并高亮原文。
- **提问**：顶部输入问题 → 不弹聊天框，而是在纸面上展开 Concept/Theorem/Formula/Experiment/Chart/Observation/Source。

## 科研真实性

每个对象标注来源：**PAPER**（论文原文，可定位）/ **CALCULATED**（确定性代码计算）/ **AI INFERENCE**（AI 仅解释与提议 What-if，绝不冒充论文结论）。所有数字来自 `src/kakeya/` 数学内核，无 LLM 生成数学。

## 架构速览

`@xyflow/react` 无限画布 · 自研 marimo 式 Reactive DAG Runtime（`src/runtime/`）· three/R3F 3D · Observable Plot 图表 · MathLive 公式 · pdf.js 原文定位。开发约束见 **AGENTS.md**。
