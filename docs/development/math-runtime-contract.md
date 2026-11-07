# 数学引擎：可执行模型、能力与游戏判定合同

> 后续隔离执行补证：见[实现调查](../research/implementation-investigation-20261106/README.md)。Cortex0.142/ml-matrix6.15.1与明确解析用例11/11，包含奇点非有限、病态SPD、绝对面积及漏采峰值反例；没有产品Skill/Run或通用ODE验收。正式注册、QualityReport及整段通闸验证仍待开发；不能将安装成功等同采用门全过。

2026-11-06，SOURCE/DESIGN核查，无新增计算/产品RUN。数学层独立于DSH、Fastify和渲染框架；接通Agent或后端不能替代本规范。桌面主项目有活跃开发，本文只交接设计，不重写其STATE/生产实现。

## 1. 审查结论与正式选型

已有数值执行积木可保留；缺口是把它们组织成能拒绝错误模型、说明精度、驱动多视图与合法动作的统一合同。不是从头写一个CAS或游戏数学核。

| 层 | 决定 | 现状与适用边界 |
|---|---|---|
| 语法/表达式 | 保留Cortex/MathJSON，逐模型scope与受限AST | 已接解析/compile。编译为JS不证明论文语义、全域合法或数值精度；假设与原式绑定，符号化简不丢条件 |
| Kakeya计算 | 保留现有TS/Worker与C++预计算 | 有真实有限尺度算法；体素估计不当连续体积定理，跨引擎同输入/seed/网格定义须一致 |
| SPD线性代数 | W3薄适配优先采用ml-matrix的Matrix/CholeskyDecomposition，注册科学能力，不在guest手写 | 本轮查源码有正定检查和solve，未安装/接入。锁release/commit并测条件数、残差与病态矩阵后采用；不把浮点Cholesky当形式正定证明 |
| ODE | 首期复用已存在TS RK4，只开放已验证的短时自主系统子集 | 当前model.solve没有显式t绑定、无自适应误差证书；不冒充SciPy solve_ivp。刚性、DAE、PDE与未支持事件拒绝或unknown。新的成熟TS/WASM求解器按真实消费者另验，不为去Python偷换精度 |
| 几何/碰撞 | 数学几何来自注册runner与误差报告；R3F/JSXGraph显示；Rapier仅为新增游戏物理 | mesh漂亮、射线命中、没有穿模都不是数学约束正确证明；解析对象/显示网格/碰撞代理版本相连 |
| 符号/PDE扩展 | SymPy/VisualPDE研究保留为可选能力，不是新默认Python依赖 | 无对应合格runner就返回unsupported。不能让DSH生成Python/JS算法绕开Registry以支持任意论文 |

官方依据：[Cortex编译](https://mathlive.io/compute-engine/guides/compiling/)、[Cortex假设](https://mathlive.io/compute-engine/guides/assumptions/)、[ml-matrix Cholesky](https://github.com/mljs/matrix/blob/main/src/dc/cholesky.js)、[公开导出](https://github.com/mljs/matrix/blob/main/src/index.js)、[MIT许可](https://github.com/mljs/matrix/blob/main/LICENSE)、[solve_ivp语义与方法](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html)、[Rapier查询对象为collider](https://rapier.rs/docs/user_guides/javascript/scene_queries/)。官网新版本不能自动当本仓Cortex0.142已支持；ml-matrix的当前源码只提供接口依据，发布版本要接入时锁定。

## 2. 数学模型不是一段公式

MathModelRevision至少包含：source/parse revision与原文区域；原始/规范AST；symbolId/scope、角色（状态/自变量/参数/观测）、shape与实/复域；单位或明确无量纲声明；允许域/排除奇点；方程/集合/约束；初边条件；PAPER条件、教学选择与未知分别记录；允许的可操作自由度。

确认要区分转写忠实、数学条件充分、算法可执行。AST合法但原文负号抄错不执行论文实验；不能从用户没反对推导确认。MVP先支持明确无量纲/同单位子集，未实现的单位换算或量纲推导返回unsupported，不做“把单位字符串删掉”的静默降级。

## 3. Skill Registry需要能力描述，不另建第二个注册表

在现有Registry上增量附加CapabilityProfile：operator/type/shape、前置条件、支持域、执行位置、模型类型、成本上限、精度政策、输出制品签名、可用控制/逆操作、验证方法与版本。旧runtime/renderer/implemented字段不够表达这些前置条件；runtime='cortex-js'也不能代表RK4或积分具体算法。

设计调用：

```text
confirmedModel + operationRequest
→ matchCapabilities → exact-match / bounded-approximation / needs-input / unsupported
→ buildExecutionPlan → 输入槽位/依赖/Skill与engine版本/预算/qualityPolicy
→ validatePlayPlan(actualInputDigest)
→ executeSkill → ExperimentRun
→ assessQuality(runId, qualityPolicy) → QualityReport
→ projectArtifacts / evaluateGoal
```

没有所需operator/条件的Skill不可凭renderer相似勉强匹配；Agent选择操作，不得修改匹配器或qualityPolicy。多核流水线每个执行步骤仍走现有executor，记录上游Run/artifact依赖；需要额外检查时也产独立校验Run或报告并引用输入，不能在前端重新算正式值。预览与正式执行用同模型修订，精度/分辨率不同须明示。

## 4. QualityReport：真实计算与可用于计分分开

现有formula.plot的integral实际是梯形近似∫|y|dx，必须命名“绝对面积估计”；peak是采样点最大绝对值（采样绝对峰值），不是一般全局最大值。带符号积分、全局极值和跨奇点积分须另匹配能力，不能复用同名指标偷换语义。

既有Run.status表示执行生命周期，不能独自表达科学可信度。QualityReport作为版本化伴随制品，逐observable引用runId/observableId(metricId)/inputDigest/kernelVersion/method/精度政策，并记录输出语义、单位/无量纲、积分/采样域及坐标映射，包含estimatedError或unknown、residual、invariants、domainViolations、conditioning、validationScope、warnings，以及qualified / provisional / rejected / unknown。同Run的曲线显示合格不表示其积分或峰值合格，逐指标评估；不改写原Run来伪造新证据。

首期误差只标实际方法能支持的等级：固定网格差/步长加密差是收敛估计，不是严格全局上界；独立解析oracle、区间界、统计误差要各自标来源和适用条件。没有证明误差界时，不把estimatedError包装为certifiedBound。

Goal须声明使用哪些observable、阈值和qualityPolicy。只有有可靠上下界时才能按上下界判定：上界低于目标才可确认相应不等式成立，下界高于目标才可确认失败；界重叠返回unknown。仅有启发式误差估计时，明确有限数值判定profile和保守边界测试，不能声称严格认证。near-boundary在更细计算仍不确定时不算赢/输。

## 5. 数学对象怎样变成世界

Scene/Control Binding只映射objectId→Run/artifactId→坐标/单位映射→显示方式与可写自由度，不保存第二份参数。显式函数、隐式集合、轨迹与向量场不是同一种输出：曲线来自函数采样；曲面来自二维域采样；等值面来自场/定义域/提取算法；动力状态是轨迹，不能默认是物理空间位置。

网格必须附采样域、分辨率、算法与拓扑/残差检查范围；仅顶点残差小不能证明曲面间隙或完整碰撞正确。数学对象用于通闸时另验整段变换/轨迹，以解析支持函数、保守包围/距离界或已声明的有界近似检查；更新mesh时同步替换匹配的collider版本。边界代理不足返回unknown。

一个实体一个位置积分器：数学轨迹由科学runner产生，R3F只插值；游戏刚体由可信物理端口持有，不再对ODE点加力。论文公式负责几何或动力学，门、角色、动作代价、信息预算、目标顺序属于显式衍生游戏政策。

## 6. 反向交互不是任意拖动都能反求

ControlPolicy定义direct parameter / constrained construction / inverse solve / view-only四种方式，绑定允许变量、域、branchId、初始候选、固定量与误差。拖动先发意图，不从屏幕位置直接修改任意参数。每个gesture的preview与commit绑定model/baseRevision/generation和branch；pointer up后对snap/钳制的最终patch重新代入原模型校验residual与合法域，报告patch/residual/branch/revision都匹配才提交。取消、求解失败、残差超限或旧代回包均保留最后合法参数，不能提交未经复验的snap值。

逆问题无解/多解/病态返回对应诊断；多解可由用户选支或沿已有连续支跟踪，不能凭“离鼠标近”静默改数学含义。比如y=a·sin(bx)：sin(bx)=0时不能从y唯一反求a；两个参数同时自由时单一拖点通常不足辨识。相机/截面是视图操作时不制造参数变化；若截面位置本身是科学测量输入则明确成为带Run的操作。

## 7. 两条完整数学流水线

Kakeya：确认有限尺度模型→冻结方向/N/δ/seed/域/计量定义→合法packing Action→preview→正式Worker或同输入预计算Run→体素/重数质量与适用范围→独立Goal→正式状态/反馈。比较须同条件或说明控制变量；改变网格不能当体积改进。单参数最优端点不自动证明有趣挑战，需真实动作/失败/重试设计。

SPD：Q/c与自由度确认→对称性/有限值/数值正定与条件门→解Qz=n→中心化support sqrt(nᵀz)（完整support另加nᵀc）→独立残差与解析对角矩阵oracle→几何/观测Run→通闸整段Action校验或公开探针观测→只读Goal。用solve求作用量，不为一次观测无谓求显式逆矩阵；盲测的Q/完整mesh/校验答案不泄露给客户端/导演。

`new CholeskyDecomposition(Q).isPositiveDefinite()`、`.solve(b)`是可复用接口；另检查对称容差/非有限/残差/病态，不偷偷对不定Q加正则并仍称原模型。Q=diag(q1,q2,q3)的support有独立解析oracle，非法/近奇异与平移应分别验。通闸和探针生成不同程序但复用同数学模型与科学能力。

## 8. 实施归属与五个必须通过的反例

N1实现模型/条件/能力匹配，S1保留输入输出/Run合同，W3注册SPD与验证profile，U1/U2接ControlPolicy和Run投影，X1扩函数/ODE误差门。质量报告不能因旧S1通过就假称已有；现有toolPort/artifacts成果复用，不重造执行器。DSH只读能力目录、创建计划、观察实际Run/QualityReport，不能绕过这些门。

1. 原式负号错读但AST可算：候选确认失败，不产论文实验成功。
2. 图像漏掉狭窄奇点/曲面孔洞：采样不足不可认证积分/碰撞；合法点采样不等于整段合法。
3. ODE粗步长仍有限但守恒漂移：执行可完成，quality不得因此合格；显含t输入不得在自主f(y)里假算。
4. 拖点反解遇零敏感/多支：返回no-solution/ambiguous/ill-conditioned，保留最后合法参数，不随意改支。
5. 相同数学对象在浏览器/Node/预计算执行：先固定AST/输入/seed/网格/算法版本，数值/质量在声明容差内一致；运行位置差异、原生/WASM或随机源不同须显式记录。

本轮仅静态研究与合同，不安装ml-matrix，不运行数值验证，不更改桌面活跃代码。正式接入须保留所锁源版本、测试与真实Run；没有通用数学能力时，允许只读解释/有界探索或unsupported，不生成假的数学世界。
