# AGENTS.md — Paper2Lab 最高开发约束

> 本文件是整个项目的最高开发约束。**每次开发前必须先读本文件**；形成新的长期设计或技术决策后**立即更新本文件**。任何与本文件冲突的临时决定都不允许直接落地，必须先修订本文件。

---

## 1. 产品目标

Paper2Lab 是一个比赛 Demo：把论文变成**真正可操作的 Reactive Paper**。

- 论文像一张铺开的真实科研纸张，存在于可自由缩放、拖拽、平移、浏览的**无限画布（科研桌面）**上。
- 论文里的**公式、参数、图、实验、结论都是活的对象**：用户改变变量（如 δ）后，相关 3D 几何、真实计算结果、图表和解释**同步变化**。
- **不是**"AI 读论文聊天工具"：用户提问后，AI 不返回聊天回答，而是在纸面上展开 Concept / Theorem / Formula / Experiment / Chart / Observation / Source 等研究对象，并自动形成空间关系。
- **不是**流程图、Dashboard 或普通白板：没有流程图箭头语言，只有"真实科研纸张 + 无限桌面"。

### Hero Demo（第一版，也是兜底方案）

**王虹 & Joshua Zahl《Volume estimates for unions of convex sets, and the Kakeya set conjecture in three dimensions》**（arXiv:2502.17655，2025，证明 R³ Kakeya 集猜想：dim = 3）。本地 PDF：`public/papers/wang-zahl-kakeya3d.pdf`。

必须真实实现：

| 要素 | 实现方式 |
|---|---|
| 2D 针旋转 | Perron 树（2^k 子三角形 + α-平移合并）+ 针动画 + Pál join 说明（PAPER 事实标注） |
| 3D δ-tubes | React Three Fiber `instancedMesh`，Fibonacci 球面方向，半径随 δ |
| Separated→Packed | tube 起点（origin）插值动画 + 真实体积指标变化 |
| δ 参数调整 | Runtime param，单一 source of truth |
| 有限尺度 cube/voxel 计算 | Web Worker 栅格化覆盖计算（确定性代码） |
| occupied volume / multiplicity | Worker 输出真实指标 + 直方图 |
| 随参数实时变化的曲线 | Observable Plot（live sweep + 离线预计算系列） |
| theorem/source 引用 | 论文原文引用 + pdf.js 定位高亮 |

**禁止用 LLM 伪造任何数学结果。**所有数字必须来自确定性代码（见 §5）。

## 2. 视觉规范

- 背景：暖白纸张 `#faf6ee` + 极淡点阵（React Flow `<Background variant="dots">`，dot `#d8cfc0`）。
- 卡片 = "贴在桌面上的纸张"：论文剪页、公式纸、实验记录、图表贴纸。浅细边框 `#d9d0bf`、轻微投影、3px 圆角、衬线字体（Iowan Old Style / Palatino / Songti SC）。
- 墨色文字 `#2b2620`，次级 `#6b6154`；朱砂红 `#9a3b2e` 用于 PAPER 标注与高亮，蓝墨 `#2f5d8a` 用于 CALCULATED/图表。
- 每张卡片左上角有小标签（CONCEPT / THEOREM / FORMULA / EXPERIMENT / CHART / OBSERVATION / SOURCE / PARAMETER）+ 来源徽章（PAPER / CALCULATED / AI INFERENCE，见 §5）。
- 边（edges）不是流程图箭头：默认几乎不可见的浅色细虚线，或仅 hover/选中时显示。
- 交互：无限缩放/平移、节点自由拖放、双击/点击 Source → `fitView` 聚焦论文对应区域。

## 3. 技术架构

版本基线（2026-10 调研后锁定；升级须先在 Spike 验证并更新此处）：

| 层 | 选型 | 版本 | 理由 |
|---|---|---|---|
| 框架 | React + Vite + TS | react 19.2 / vite 7 / ts 5.9 | fiber v9 peer 要求 react ≥19 <19.4 |
| 画布 | @xyflow/react | ^12.12 | 无限画布事实标准；自定义节点 + nodrag/nowheel + Background dots + fitView 聚焦 |
| 3D | three + @react-three/fiber + drei | 0.186 / 9.8 / 10.7 | InstancedMesh 千级 tube / 十万级 voxel；`eventPrefix="client"` 修正变换容器内指针 |
| 图表 | @observablehq/plot | ^0.6 | 科研图表语法（binX 直方图、line+dot），数据驱动重绘 |
| 公式 | mathlive | ^4 | MathField 公式交互 |
| PDF | pdfjs-dist | ^4.10 | 本地论文渲染 + TextContent 坐标定位高亮（v4 + Vite `?url` worker，稳定） |
| 反应式 | **自研轻量 DAG Runtime**（~200 行） | — | marimo 思想：param/derive/asyncDerive + useCell；无现成库同时满足显式命名 cell + 拓扑序 + Worker 异步 stale-while-recompute（调研结论：jotai 图是隐式的，signals 无异步） |
| 测试 | vitest | ^3 | 数学内核单测（面积/体积不变量） |

关键实现约束：

- **Reactive Research Runtime**（`src/runtime/`）：一个参数只有一个 source of truth。`param(name, init)` / `derive(name, deps, fn)` / `asyncDerive(name, deps, fn)`（Worker 计算，stale-while-recompute，version 防乱序 commit）/ `useCell`（useSyncExternalStore）。参数变化 → 拓扑序重算受影响 cell。**禁止在 Slider 回调里手工分别更新多个组件。**
- **有限尺度计算放 Web Worker**（`src/workers/`）；较大尺度用 `scripts/precompute-kakeya.mjs` 离线预计算（seeded 可复现）→ `src/data/kakeya-precomputed.json`。
- 节点内的交互元素（slider、3D 拖拽、滚动 PDF）必须带 `nodrag`（必要时 `nowheel`）；R3F `<Canvas>` 需 `eventPrefix="client"` + pointerdown capture `stopPropagation`，防止拖动 3D 时拖走节点/画布。
- 3D 场景节点数控制在个位数（WebGL context 成本）；`dpr={[1,2]}`，静止时 `frameloop="demand"`。

## 4. 科研真实性原则（不可妥协）

所有内容必须三选一标注来源徽章：

1. **PAPER** — 论文事实：只来自 `public/papers/wang-zahl-kakeya3d.pdf` 原文（或明确给出的文献引用），卡片注明引用（定理号/页码/章节），可跳转定位。
2. **CALCULATED** — 数字：只来自确定性代码（`src/kakeya/` 内核、Worker、预计算脚本），注明计算方式与参数；LLM 不得产生或改写任何数字。
3. **AI INFERENCE** — AI 只负责解释与提出 What-if 实验；任何 AI 推断都不能冒充论文结论或数学证明，卡片必须显式标注，且引用的数值必须指向 CALCULATED cell。

无 LLM API key 时：降级为本地确定性 expansion packs（预 authored 论文知识图），不阻塞 Demo。

## 5. 目录结构

```
AGENTS.md                 ← 本文件（最高约束）
public/papers/            ← 论文 PDF（本地，避免 CORS）
scripts/precompute-kakeya.mjs  ← 离线预计算（可复现）
spikes/                   ← 技术 Spike 页面（保留供回溯）
src/
  runtime/                ← Reactive Research Runtime（DAG cells）
  kakeya/                 ← 数学内核（纯函数，无 React 依赖）
    directions.ts         ← Fibonacci 球面 δ-分离方向
    tubes.ts              ← tube 生成（separated/sticky/packing 插值）
    voxels3d.ts           ← 有限尺度覆盖计算（occupied volume/multiplicity）
    perron.ts             ← Perron 树构造 + 栅格化面积
    metrics.ts            ← 直方图等指标整理
  workers/voxel.worker.ts ← Worker 入口
  canvas/                 ← 无限画布与节点组件
    DeskCanvas.tsx, nodes/*.tsx
  paper/wangZahl.ts       ← 论文知识：定理引文、公式、概念、expansion packs
  styles/paper.css        ← 纸张视觉系统
  data/                   ← 预计算 JSON
tests: 与内核同目录 *.test.ts（vitest）
```

## 6. 允许复用（禁止重复造轮子）

无限画布/节点系统 → xyflow；3D → three/R3F/drei；图表 → Observable Plot；公式 → MathLive；PDF → pdf.js；依赖图思想 → marimo（借鉴设计，自研轻量实现）。**不得重新实现上述基础设施。**

## 7. 禁止事项

- 禁止把产品做成聊天窗口 / Dashboard / 流程图工具。
- 禁止 LLM 生成数学数字或"证明"；禁止把 AI 推断标成论文结论。
- 禁止在组件回调里手工联动多个组件（必须走 Runtime）。
- 禁止引入未在本文件登记的大型依赖（先 Spike、后登记、再使用）。
- 禁止只写代码不运行：每阶段必须实际运行页面、查 Console、测交互。
- 禁止删除/绕过本文件。

## 8. Git 规范

- 提交前缀：`research:`（调研/Spike）、`feat:`、`fix:`、`perf:`、`test:`、`docs:`、`chore:`。
- 重要功能独立 commit；AGENTS.md 的状态更新随对应功能一起提交或单独 `docs:` 提交。

## 9. 当前完成状态（随进度更新）

- [x] 技术调研（xyflow / marimo / R3F / Plot+MathLive+pdf.js / 论文数学事实 / Perron 树构造）— 结论在 §3
- [x] 脚手架 + Git + Linear 项目（Paper2Lab / P-CLI-3，CLI-29..40）
- [x] Kakeya 数学内核 + 22 项 vitest（voxel 体积与解析胶囊值 6% 内标定；Perron 面积单调性）
- [x] Reactive Runtime（param/derive/asyncDerive + useCell；stale-while-recompute + generation 防乱序）
- [x] Spike 实测（#spike 路由；RF×R3F×Plot×pdf.js×Worker 组合在浏览器验证后合入产品）
- [x] 无限纸面画布 + 14 类节点（paper/theorem/formula/concept/source/params/experiment3d/chart×2/perron/observation/whatif/sandbox/runtimeGraph）
- [x] 3D δ-tubes 实验（InstancedMesh 512 管 + voxel 视图）+ Worker 联动 + 指标卡
- [x] Perron 2D 实验 + 针旋转动画（RAF + 直接 DOM 写入）
- [x] Observable Plot 图表（multiplicity 直方图 + |⋃T| sweep 曲线，live + 离线预计算双系列）
- [x] pdf.js 论文页 + 定位高亮（注意：arXiv PDF 有封面页，定理锚点在 p.3；文本匹配需折叠多空格并维护 per-char→item 映射）
- [x] 提问 → expansion packs（关键词路由，无聊天框；AI 只解释/What-if）
- [x] 离线预计算脚本（scripts/precompute-kakeya.ts，Node 原生 strip-types，复用同一内核）
- [x] 端到端验收：δ/packing 拖动 → 3D+指标+图表+观察联动（Σ|T|≈N·πδ² 与解析吻合；packing=1 时 max m=N）；定位原文高亮；Console 无错误（仅 three 内部 Clock 弃用 warn）

## 10. 下一阶段任务（比赛迭代方向）

1. 视觉打磨：卡片入场动画、桌面纹理、minimap 主题化。
2. Runtime 图可视化升级（DAG 连线图，替代列表）。
3. 更多 expansion packs（Wolff hairbrush、σ/ω 断言等）与第二个 what-if 实验的参数预置。
4. 交互 3D：OrbitControls（需处理与节点拖拽的事件冲突）或预设机位切换。
5. 移动端 / 触控板手势适配。

---

*Linear 项目：Paper2Lab（P-CLI-3）。数学事实来源：arXiv:2502.17655（Wang–Zahl）；Perron 树构造来源：Besicovitch/Perron（经典），实现按 Wigderson–Yuval 讲义与 Alan Chang MathCamp 讲义的合并引理（面积 ≤ (α^2k + 2(1−α))·A）。*
