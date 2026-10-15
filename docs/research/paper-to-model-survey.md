# 调研：论文理解 → 引擎构建数学模型（2026-10-15）

> 背景：用户判断「数据流转有问题」，目标是**真的把数学问题通过引擎构建成数学模型**——参数可改、
> 且改动能让人**理解下去**（理解论文内容 → 启动编译执行）。本调研用 GitHub 实查同类项目，
> 对照诊断我们的数据流断层，给出四层方案与落地切片。原则不变：AI 不产生数值（宪法 §0.7），
> 模型由确定性内核执行，数字只能来自 ExperimentRun。

## 一、外部项目实查（gh 检索 + README 精读）

| 项目 | 规模 | 机制 | 对我们的启示 |
|---|---|---|---|
| **Paper2Code** (going-doer, ICLR'26) | 4,982★ | 多 Agent 三段流水线：planning → analysis → **代码生成**（LLM 产出整个代码仓库） | 三段式（规划/分析/物化）值得借鉴；但终点是「LLM 生成的代码仓库」——不可控、与我们宪法冲突，**不能走它的终点** |
| **SciCode** (scicode-bench, NeurIPS'24) | 239★ | 科学家标注的 80 个真实科研问题→338 子问题，评测 LLM 写仿真代码；最强模型主问题解决率仅 **10.8%** | **直接证据**：让 LLM 从论文写科学代码目前不可行（~10%）；我们的「确定性内核执行 + LLM 只做理解/路由」路线正确，且应把「模型物化」与「代码生成」严格区分 |
| **marimo** | 23,186★ | reactive notebook：纯 Python 存储、cell 即依赖图、参数是一等公民、可部署为 app | 与我们 Reactive Runtime 同构；借鉴**参数即 cell**的一等公民形态与「 notebook 即脚本」的复现性 |
| **PhET** (phetsims/*) | 组件级 | 教育交互模拟：目标-约束-预算的关卡化探索 | 已在三关挑战复用；其「参数 ↔ 现象即时反馈」是我们的 Live Params 目标形态 |
| **sympy-live / SymPy Live (JupyterLite)** | 118★ | 浏览器内 CAS（Pyodide） | 我们已有 Pyodide 路径（下一篇论文预留），生态位不冲突 |
| **Stencila** | 909★ | 「带科学智能的文档」：可执行文档出版 | 证明「可执行论文」生态位真实存在；我们差异在**交互实验**而非出版 |

**结论**：没有人同时做「论文语义理解 → 结构化数学模型构建 → 确定性引擎执行 → 参数级理解反馈」。
Paper2Code 止于代码生成（不可控）、SciCode 证明该路目前不可行、marimo/PhET/Stencila 没有论文理解层。
我们的定位是空白区，且既有资产（Reactive Runtime、ExperimentRun、Skills Registry、VLM 摄入）恰好各就各位。

## 二、我们的数据流断层诊断（现状逐层过堂）

现状链路：`PDF → VLM/Docling → IngestedDoc(items) → adapterRouter(关键词+latex 形态) → binding →
四类预制实验(formula.plot/ode.phase(仅2态)/fit/kakeya) → explorerStore → Run`。四个断层：

**断层 1：没有「理解」对象。** IngestedDoc 只有 text/latex/table 条目；论文研究什么问题、
定义了哪些量、参数的物理意义/单位/论文给定范围、论文的命题（claims）——全部不存在于数据结构里，
只在 Agent 上下文的 1500 字 textHead 里隐约出现。**理解没有沉淀，每次下游都重新猜。**

**断层 2：模型构建被硬编码成四个抽屉。** router 靠关键词把论文塞进 formula/ode/fit/kakeya；
binding 只认「恰好 2 条 \dot 方程」或「单公式+数据表」。3 态以上的 ODE、代数方程组、递推、
混合系统——读了论文也建不了模。**引擎有真执行能力，但没有「模型物化」这一层。**

**断层 3：参数与理解脱钩。** 参数芯片 min/max/step 是全局默认（-5..5/0.05），不是论文的名义值与
范围；拖动后的 Observation 是模板化 regime 文案，**从不引用论文命题**（「论文 §3 预言增大 δ 则 X，
你的实验显示 Y」这种对照不存在）。

**断层 4：理解状态四处散落且单向。** needs-info 问到的初值用完即弃（不回存）；fork 对比是
Run↔Run 数值对比，不回连论文；IngestedDoc / binding / explorerStore / agent context 四处各存一份
语境，无单一事实源。

## 三、方案：四层数据流（理解 → 物化 → 活参数 → 理解反馈）

### L1 Comprehension —— 新对象 `PaperModelSpec`（理解的单一事实源）

```ts
interface PaperModelSpec {
  question: string                     // 论文研究的问题（原文锚点）
  quantities: { name; role: 'state'|'parameter'|'observable'|'independent';
                 unit?; nominal?; range?; source: anchorId }[]   // 量的分类与来源
  equations: { latex; role: 'governing'|'initial'|'definition'; anchorId }[] // 任意 N 条
  claims: { statement; anchorId }[]    // 论文命题（Observation 对照用）
  provenance: { engine: 'deterministic'|'vlm'|'user'; }          // 每字段可追溯
}
```
- 三通道填充：**确定性**（Cortex 解析 latex 方程/初值/表格——已有内核）+ **VLM 结构化提取**
  （现有视觉 prompt 扩展输出 symbols/units/ranges/claims，全部标 AI_INFERENCE）+ **用户问答沉淀**
  （needs-info 的回答写回 spec，不再用完即弃）。
- 存 explorerStore；adapterRouter 降级为「按 spec 选实验桌面」的薄层。

### L2 Model Construction —— 新技能 `model.build` / `model.solve`（引擎物化模型）

- `model.build`（CALCULATED，PlayPlan 门）：输入 spec.equations（N 条 latex）→ 逐条 Cortex 编译成
  JS（复用 compileExpr/Equal-RHS 内核）→ 产出 `CompiledModel`（N 态 ODE / 代数 / 显式函数分类），
  Run kind `model.compiled`（携带每条方程的 anchorId）。
- `model.solve`：N 态 RK4（ode.phase 泛化，保留周期/守恒量度量），事件检测留接口。
- `model.evaluate`：代数模型求值（fit 类合并进来）。
- **数字仍 100% 来自引擎执行**；LLM 不碰这一层。

### L3 Live Params —— 参数芯片吃 spec（不再全局默认）

- 芯片 nominal/min/max/step 优先级：论文给定（spec.quantities）> 数据推断 > 登记默认。
- 拖动 → preview → exact 双层与 graph⇄param 反向已有，不动。

### L4 Understanding Feedback —— Observation 升级为「命题对照」

- Observation 文案结构：论文命题（PAPER 引文+锚点）→ 当前 Run 事实（CALCULATED）→ 一致性陈述
  （确定性比较优先，AI_INFERENCE 仅解释不判决）。
- Agent explain_result 的输入加入 claims；fork 对比卡增加「与论文命题的对照」行。

### 与外部项目的差异化定位

- vs Paper2Code：他们生成代码（不可控），我们**生成模型配置**并交给注册内核执行（宪法 §0.7）。
- vs SciCode 路线：不要求 LLM 写科学代码（10% 可行性），LLM 只做它可靠的「阅读与结构化」。
- vs marimo：同 reactive 内核思想，但我们有论文理解层与 Run 可追溯协议。
- vs Stencila：同为可执行论文生态，我们做交互实验而非出版排版。

## 四、落地切片（建议顺序，每片独立可验收）

1. **Slice A（理解卡）**：`PaperModelSpec` 类型 + VLM/确定性双通道提取 + 桌面「理解卡」纸
   （问题/量/参数表/命题，逐字段 AI/原文标注）；验收用现有四篇真实论文 fixtures——
   ODE 两篇量分类与初值全对、fit 两篇参数名义值与数据点对上。
2. **Slice B（模型物化）**：`model.build`/`model.solve`（N 态 RK4）+ ode.phase 迁移其上；
   验收：3 态系统（新造一篇 fixture 论文）真算收敛/周期。
3. **Slice C（活参数）**：参数芯片范围来源切换到 spec + needs-info 回写。
4. **Slice D（理解反馈）**：Observation 命题对照 + fork 对比卡对照行 + Agent claims 上下文。

风险与边界：VLM 提取的单位/范围可能错——一律 AI_INFERENCE 标注 + 用户可改（改=provenance: user）；
PDE/随机系统 0.2 不做（引擎无内核，诚实 out-of-scope）；论文无量纲约定时 range 缺省退回登记常量。
