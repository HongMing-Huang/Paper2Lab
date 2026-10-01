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

## 2.5 交互契约（Interaction Contract）v2

- 用户动作优先级：**experiment > computation > visualization > explanation**。
- **可运行的科研问题绝不允许只给文本回答**：每个回答必须伴随可执行实验/计算结果（数字、图表、几何）。
- 画布是主产品面：节点必须像真实科研纸张（剪页/公式纸/实验记录），不是 workflow 卡片。
- **P0 画布能力**：pan、zoom、selection（Shift 框选/多选）、**grouping（成组）**、**experiment forks（实验分叉）**、**spatial comparison（空间对比）**。

## 2.6 Scientific Skills 注册表（v2 新增）

所有科研能力必须注册为**显式技能**（`src/skills/`），七族：`inspect / simulate / measure / compare / infer / trace / verify`。每个技能声明：

```ts
interface SkillDeclaration {
  id: string                    // 如 'measure.coverage'
  family: 七族之一
  input_schema: JsonSchemaLike  // { type:'object', properties, required }
  output_schema: JsonSchemaLike
  runtime: 'main' | 'worker' | 'pyodide-worker'
  evidence_type: 'PAPER' | 'CALCULATED' | 'AI_INFERENCE'   // 不可混用
  dependencies: string[]        // 依赖的内核模块/cell/其他技能
  run(input): Promise<output>
}
```

- 技能通过 `runSkill(id, input)` 调用，每次运行写入 **EvidenceLog**（输入、输出、时间、cell 版本戳），供证据链卡溯源。
- `infer` 族输出固定为 AI_INFERENCE；`simulate/measure/compare/verify` 固定 CALCULATED；`inspect/trace` 可引用 PAPER 锚点。

## 2.7 本地计算与 Pyodide 政策

- 科研计算优先**本地确定性执行**；耗时计算放 Web Worker。
- **Pyodide**：调研结论（2026-10-01，gh 搜索 + 克隆 eqs/pyodide-vite 到 ~/Desktop/paper2lab-research/ 实测研究）——npm 打包的 pyodide 在 Vite 下 `loadPackage('numpy')` 因 wheel 完整性校验失败；**采用官方推荐 CDN + indexURL 方式**：专用 module worker 内懒加载 `https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs`。
- Pyodide 技能是**可选运行时**：离线/加载失败时技能返回 `available: false`（UI 明示），绝不报错阻塞 Demo；数值正确性**永不依赖** Pyodide 或 LLM。
- 本地 LLM 推理可选，仅用于 `infer` 族的解释文本；无 key 时用确定性模板。


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

v1（2026-10-01 上午）：

- [x] 技术调研（xyflow / marimo / R3F / Plot+MathLive+pdf.js / 论文数学事实 / Perron 树构造）— 结论在 §3
- [x] 脚手架 + Git + Linear 项目（Paper2Lab / P-CLI-3）
- [x] Kakeya 数学内核 + vitest（voxel 体积与解析胶囊值 6% 内标定；Perron 面积单调性）
- [x] Reactive Runtime（param/derive/asyncDerive + useCell；stale-while-recompute + generation 防乱序）
- [x] Spike 实测（#spike 路由）后合入产品；无限纸面 + 18 类节点
- [x] pdf.js 定位高亮（封面页锚点 p.3 + 多空格折叠匹配）；提问→expansion packs；离线预计算
- [x] 端到端验收（δ/packing 联动、Σ|T|≈N·πδ²、Console 干净）

v2（2026-10-01，交互契约 + Skills + P0 画布）：

- [x] 交互契约落地：未知问题自动运行对比实验（绝不纯文本回答）；chip"对比 separated vs sticky"
- [x] Scientific Skills 注册表：7 族 10 技能，schema/runtime/evidence_type/dependencies 声明；runSkill 校验 + EvidenceLog（cell 版本戳）
- [x] 实验 Fork：快照（参数+committed 指标+版本戳）/恢复（仅 setParam）/对比卡（Δ+相对变化，实测 max m +773%）
- [x] 证据链卡：参数→cell→技能→PAPER 全链（15 项，带版本与 stale）；verify.invariants 5 项全过；verify.pyodide_numpy 在浏览器真实跑通（NumPy MC 交叉验证，CDN Pyodide v0.27.7 in worker，离线降级 available:false）
- [x] 画布 P0：Shift 多选 + 框选模式开关（panOnDrag/selectionOnDrag 切换）；成组/拆组（纯函数坐标变换，4 项单测含 round-trip）
- [x] v2 浏览器回归：干净页面 Console 0 错误；39/39 vitest；build 通过

## 10. 下一阶段任务（比赛迭代方向）

1. 视觉打磨：卡片入场动画、桌面纹理、minimap 主题化。
2. Runtime DAG 可视化升级（连线图替代列表）+ 技能面板（浏览/调用全部已注册技能）。
3. Pyodide 技能扩展（SciPy 拟合 |⋃T|~N 标度律）；本地 LLM 接入 infer 族（可选）。
4. 交互 3D 机位；移动端适配。
5. 更多 expansion packs（Wolff hairbrush、σ/ω 断言）。

---

*Linear 项目：Paper2Lab（P-CLI-3）。数学事实来源：arXiv:2502.17655（Wang–Zahl）；Perron 树构造来源：Besicovitch/Perron（经典），实现按 Wigderson–Yuval 讲义与 Alan Chang MathCamp 讲义的合并引理（面积 ≤ (α^2k + 2(1−α))·A）。*
