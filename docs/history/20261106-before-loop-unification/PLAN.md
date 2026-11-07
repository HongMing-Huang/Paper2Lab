# Paper2Lab 产品开发计划

2026-11-05 审查修订。覆盖整个产品；列入计划不代表已实现。执行协议见[LOOP](LOOP.md)，进度、阻塞和人工问题只记[STATE](STATE.md)。用户说“开发”后执行可验收的开发切片，不再生成一轮泛研究。

## 1. 产品完成意味着什么

用户上传PDF或添加论文标识 → 原文立即可读、解析可追踪 → Agent围绕问题检索和阅读有来源的材料 → 建立带条件与不确定性的数学模型 → 调用真实计算 → 生成、验证并进入数学游戏世界 → 玩家操作、失败、重试、获得提示和下一挑战 → 回到论文、对比实验和研究历史。刷新、断线、服务重启后仍能找到已提交的论文、Run与任务；需要人工的分支可等待，其他分支继续。

按三个产品检查点推进，不能把其中一个称作整个产品完成：

- **C1：可研究的论文。**真实PDF、文献工具、真实Qwen自主工具回合、真实Run、可恢复研究桌面一起工作。
- **E1：可进入的数学世界。**在C1上，同一有来源的正定二次型产生两种行为不同的游戏程序，有操作、判定、提示、重试、回放和下一挑战。
- **E2：可持续使用的产品。**函数/动力系统复用同一世界协议；跨论文研究可追溯，取消、恢复、权限、备份与生产构建验收通过。实际发布另按既有授权执行。

“任意数学论文自动变成游戏”不是可兑现的验收承诺。支持能力由注册内核及验证方法决定；不支持、缺条件和数值不确定必须明确返回。扩展对象靠能力适配，不以论文关键词分配固定小游戏，也不为每篇论文另写React页。

## 2. 模块、责任和数据流

这是五个逻辑边界，先复用现有目录，**不建五个包或五个服务**。

| 模块 / 现有落点 | 拥有的状态与公开责任 | 不拥有的责任 |
|---|---|---|
| Paper Library / server/、src/ingest/、src/skills/paperSpec.ts | Paper→不可变PaperVersion→ParseArtifact→SourceAnchor；CitationRelation；候选/确认MathModelRevision；论文导入、检索、证据读取 | 不把摘要、标题相似或VLM猜测当正文事实；不重复造PDF解析器 |
| Research Agent / server/agent.py、agent_provider.py、src/desk/agentState.ts | ResearchTask、Session与ToolInvocation；根据真实回执选择工具、管理问题与预算、生成世界草案、提示与下一挑战 | 不产生CALCULATED数字、不写Run、不进逐帧循环、不直接批准自己生成的目标 |
| Scientific Runtime / src/skills/、src/experiments/、src/runtime/及现有Worker/Node桥 | 参数与依赖、能力目录、PlayPlan验证、确定性执行、不可变ExperimentRun、误差与可比性 | 不依赖Harness、React或游戏ECS；不被新框架替换 |
| MathWorld / 新内部目录src/mathworld/ | WorldProgramRevision、Action/Rule/Goal、GameplayState与HostProtectedState、Solver、PlayAttempt、Progression、Replay | 不存第二份科学真值；guest不能写权限、预算、回执或Assessment |
| Lab UI / src/desk/、src/canvas/、现有PDF/R3F | 阅读/选择/布局/镜头、输入意图、CanvasCommand及应用回执；投影Run、世界和任务状态 | Canvas只存引用/布局；UI不计算正式科学指标、不把“命令已排队”称为“画布已应用” |

持久任务是共享执行设施：PostgreSQL保存身份/版本/关联/任务/事件/outbox，内容寻址文件保存PDF、解析件和大数组；RQ+Redis/Valkey先承接一个真实解析任务，再接科学/Agent任务。复用现有FastAPI部署和Node内核，先单实例。不让Harness日志、队列缓存或Canvas成为领域事实的唯一存储。

主调用链：用户意图 → ResearchTask/Session → 注册工具 → 来源/模型/PlayPlan门 → JobAttempt或直接执行 → Run/世界制品及持久回执 → 事件cursor → UI应用回执 → Agent观察真实结果再决策。

玩家链：输入 → World Host验证Action → 必要的Scientific Skill → 合格Run → 候选世界转换及独立Goal求值 → 按expectedRevision原子提交世界/判定/事件 → Feedback/Replay事件。渲染逐帧投影已提交状态；LLM只在关卡边界、请求提示、关键失败等事件唤醒。一个实体只有一个位置积分器；ODE轨迹与游戏物理不能同时写它。

主选保留React/tldraw/Three/R3F/Drei，Koota组织实体，QuickJS隔离生成行为；Rapier只为明确需要的碰撞/角色机制接入，不能替代数学约束检查。PlayCanvas React为备选，不维护双renderer；不迁移Godot。首期事务Run/已计算轨迹，连续SimulationEpisode/WorldFrame另修协议后才能进入科学路径。

## 3. Agent与其他工具怎样形成产品

### 3.1 一套工具面，多个执行适配器

以下是**待实现的语义工具合同**，不是宣称这些同名端点已经存在。工具目录组合现有Scientific Skill Registry、来源/世界/任务工具；科学输入输出schema从现有注册表导出，不再在Python复制一套。AgentScope先使用这套工具面；DSH仅在同一合同下做受限对照，不作为产品前置依赖。

| 工具组 / 最小操作 | 输入与真实回执 | 实现与验收边界 |
|---|---|---|
| 论文 library.search/resolve/acquire/parse/references | query/标识/versionId/配额 → 候选、身份冲突、blob或jobId、显式引用边与coverage | 复用Docling/VLM；先接可用的OpenAlex/Crossref/arXiv最小链，Semantic Scholar/Unpaywall按真实需求补。缺全文、429、来源图缺边分开；无默默批抓论文 |
| 证据 source.read/evidence.find | versionId/anchorIds/question/大小上限 → 原文片段、textHash、页/区域精度、检索方法 | 先消费已有解析文本；PaperQA2预解析入口在小语料检索对照后接入；GROBID仅补引用缺口。未通过前不堆向量库/重排服务 |
| 模型 model.inspect/propose/validate | 来源锚点/候选修订 → 量、条件、缺失项、能力及可执行性报告 | 扩展paperSpec/MathJSON；模型提议与确认修订分离。可由可核查原文与确定性校验确认，不要求每个字段都问人；含歧义的关键条件不自动补齐 |
| 实验 experiment.plan/execute/read/compare | modelRevisionId、参数/域、validatedPlanId、幂等键 → jobId/runId/validation/制品引用 | 委托既有executeSkill；PlayPlan须绑定模型修订和实际输入digest，不只检查“注册过同技能”。误差未知/失败Run不可计分 |
| 世界 world.propose/compile/playtest/revise | 模型/能力、程序草案、诊断、资源限额 → 不可变程序revision、诊断、见证/反例/unknown | Qwen生成有行为语义的程序，经编译、沙箱与独立验证；禁止返回mechanicId冒充新玩法。修复创建新revision，不改正在玩的冻结规则 |
| 导演 play.inspect/request_hint/propose_next | 已提交的玩家事件摘要、失败与Run引用 → 有依据的提示或待验证下一关 | 难度依据尝试/信息/动作代价调整，不擅改数学模型。世界公开观察与私有答案分离，提示不能绕过信息规则泄露答案 |
| 工作空间 canvas.apply/focus/trace | commands、expectedRevision → durable commandId，再获应用ack/拒绝 | 复用agentActions/agentBridge；离线保留待投影，重连按cursor去重。不能在服务端伪称已完成浏览器交互 |
| 任务 task.inspect/cancel/answer | taskId、attemptId或questionId、输入修订 → 检查点/取消请求/答案应用结果 | 取消先cancel_requested，确认worker停止后cancelled；人工回答必须绑定问题版本，过期回答不自动改新任务 |

每次调用携带workspaceId/taskId/invocationId/toolVersion/expectedRevision/idempotencyKey/inputDigest/budget；副作用工具验证权限、对象归属与版本。结果统一为completed/accepted/needs_input/unsupported/retryable_error/terminal_error，携带适用的jobId/runIds/artifactRefs/errorCode/missingFields/usage/retryAt。accepted不是completed。科学动作另绑定baseRunId/expectedExperimentRevision，执行端从获准Run读取真实输入；继续当前分支或从旧Run另Fork均须显式指定，选区变化不能改掉在途目标。技能/对象不匹配返回错误，不静默改写desk或op。相同幂等键异payload拒绝，异步旧attempt不得覆写新状态。大结果按选择器取，不把截断JSON当完整结果。

外部论文、工具文本和生成程序均是非可信输入；不能通过其中的指令提高权限。默认工具面不提供任意shell、文件写入、任意网络地址或自动安装插件。凭据留在服务端配置，不进提示、浏览器包、STATE或日志。

### 3.2 产品Agent的运行循环

恢复任务 → 读取来源/模型/当前选择/相关历史 → Qwen选择一个有预算的工具动作 → Host验证并执行 → 记录真实回执 → Qwen据此继续、转分支、提问或结束。这是自适应工具循环，状态机仅管理执行生命周期，不写死科学研究步骤。

按需使用三种工具权限配置：研究（来源/建模/实验）、生成（程序草案/编译/试玩诊断）、导演（公开玩家摘要/提示/下一关）。先复用同一Agent运行器和独立上下文，不预建三个常驻Agent。以后引入Subagent，必须有独立预算、明确输入输出和取消传播；它仍不能扩大父任务权限。

Session上下文从持久事件/来源引用恢复，同一Session的工具回填串行关联；不能把model toolCallId当runId或任务ID。发送给模型的内容按当前问题选取来源/模型/Run摘要及制品选择器，标明覆盖范围，避免整体硬截断后假称读完论文。刷新不会启动第二个同任务Agent；模型回合中断后先核对未决调用回执，不从第一步重放所有副作用。activation检查点持久保存已提交assistant工具批次、顺序、reply/toolCall关联ID、逐项回执引用与模型/工具目录版本；摘要不能替代消息协议。先核对锁定AgentScope的导出/恢复能力，若不能恢复中间态，则在已提交批次边界重建有新身份的activation，不声称恢复原内存栈。

DSH试点若满足迁移门：Plugin用defineTool/ctx.tools.register适配同一工具目录，SDK传会话输入与任务/调用引用，不共享可写科学状态；Session.run放受管后台执行且同Session串行。Workflow/Subagent只能组合授权工具与独立预算，不代替领域验证、RQ恢复或OS隔离。试点真调用/取消/恢复未过前，不删除现有AgentScope可用路径；通过后按可删除代码与维护收益另作决策。

每轮设置模型轮数、工具数、检索扩展、计算/修复、token和墙钟预算；初始限额在执行前沿用已有有限配置或登记保守上限，再按实测调整，不从论文提取或让模型改。达到预算保存检查点并暂停该分支；没有新输入不自我唤醒。工具超时、空检索、invalid-plan、provider失败与数学unknown分别返回，不能都回退为成功文字。离线SOP可保留且显式标注，不用于签收自主Agent；“连续/多轮/研究循环”等自然语言不能绕过模型。固定扫描作为显式工具或离线选择，backend/mode按真实执行路径记录。

遇到缺条件，先读原文或已授权来源；仍未知时创建具体问题，挂起相关模型分支、释放运行槽位，可继续其他论文/能力。新回答创建模型/计划修订，重验后续制品；不把等待时间、模型猜测或用户没反对当确认。产品内的问题与开发STATE里的问题使用相同原则，但数据分别存产品数据库与开发记录。

### 3.3 必须先落实的执行合同

- **计划绑定分两步。**S1对现有Spec绑定canonical skill/version、规范化输入digest、source、parent和执行预算；N1再绑定不可变modelRevisionId。参数变化产生新计划/Run，不能复用旧digest。服务端自行计算digest，禁止相信模型提交的hash。公共工具不接受replay或放宽验证开关；内部Replay仍核对模型、版本与权限。
- **科学制品边界。**首期正式Run内联结果采用schema明确的JSON值，拒绝TypedArray、共享buffer及非有限数；缺失可选字段与null按schema规范化。大数组经Runtime校验、复制/封存，使用dtype/shape/byteLength/hash/engine版本制品引用；所有权与只读读取明确。渲染器可自行构造临时buffer，但不能反写已提交证据。S1校验入口，D1持久化制品，W3消费同一合同。
- **身份与幂等。**operationId代表一次语义操作，attemptId代表执行尝试，invocationId代表一次工具调用，三者与runId分开。持久唯一键为workspace+operation+idempotencyKey；同键异输入返回冲突，重试查询既有回执。任务重启不得仅因换attempt产生第二个Fork。供应商未提供幂等保证时，只能记录调用结果不明与可能费用，不承诺外部调用恰好一次。
- **落盘与恢复。**Scientific Runtime负责产生/校验Run，领域仓库负责可靠保存。制品先按hash写入并校验，再在一个数据库事务中提交Run索引、操作回执、状态与outbox；事务成功才报告持久completed。崩溃留下的无索引制品可后续清理，不能发布成成功。迁移后旧JSONL只读，禁止旧路径继续写成另一权威；旧ID保留、缺失来源标legacy/unknown，不伪造。回滚必须包含切换后新增数据的导出/复验，不能直接倒回过期快照。
- **任务与取消。**Job状态至少queued/running/waiting_input/retry_wait/cancel_requested/cancelled/succeeded/failed/interrupted；waiting_input释放worker与并发槽，仅保存检查点。lease到期由reconciler核对并重排，fencing token拒绝旧worker提交。取消与完成竞争按数据库原子状态转换裁定；已完成结果不能被迟到的cancel覆盖。RQ不代替这些领域语义，长会话按有界activation运行，不占着worker等用户。J1采用每个计算worker独占一个引擎子进程、单次在途科学操作，仍跑同一executor；健康检查不能用排在长计算后的短ping判死，查询读领域回执。取消只作用于所属attempt的执行单元，确认退出并回收后复用。桥层不暗中重启重放有副作用操作；重试由任务账本核对回执后安排。
- **科学与世界提交。**一次Action冻结program/model/goal revision、seq、公开观察和预算预留；科学调用失败或Goal求值异常时不改世界/不给分。有效Run可能已产出，保留其回执和实际资源消耗；外部计算不能回滚。资源/费用账与玩法预算分离：资源预留在执行前持久登记，成功、拒绝、异常、取消和过期均结算实际消耗；用量未知时保留保守预留并标待核对，不退成零。重复回执不重复记账，但真实重试产生的新用量必须累计。玩法动作次数是否在失败时扣减由冻结规则决定，失败同样记录幂等的玩法扣费/拒绝事件。只有候选转换与Assessment全部合格且expectedRevision仍匹配，才一次提交成功世界状态、计分及对应玩法账/事件；资源消耗不随其失败回滚。重试复用操作回执，旧响应不改变当前世界；preview不参与正式Goal。Goal正常返回未达成或游戏失败是有效Assessment，可按冻结规则提交动作/失败事件；只有求值异常、不合法证据或版本冲突才拒绝候选提交，不能把“尚未获胜”当事务错误。相机/选区等纯呈现操作只记UI状态，不制造科学Run。
- **生成验证的上限。**任意JS程序的可解性、终止性不能由通用Solver保证。只发布在明确有界状态/动作/时域与验证profile内取得见证、经新VM重放且独立科学谓词验过的挑战；其他为unknown/unsupported，不能默认可玩。退化Goal检查是有限测试，不能宣称证明所有输入合法。精度、误差与碰撞代理版本绑定Run，接触临界或几何重建不一致时拒绝/unknown；更新几何时同步替换匹配的碰撞代理。

首期不实现所有工具和表：A1只接已有真实科学工具消费者；A0尽早验一次真Agent→工具→Run回填；D1只落真实上传需要的身份/制品索引。随后按P1/J1/L1扩展同一工具合同。所有预算在付费调用或执行开始前有有限上限；实测只用来调整上限，不允许“测完再限额”。

## 4. 开发任务与验收

依赖列只写硬依赖；表格顺序是同等条件下的优先顺序。一个任务被阻塞不阻止无依赖的其他任务。每行是工作包，执行前按LOOP在STATE拆一个可验收子项；不能一次提交整行全部代码。

B0先固定一次默认完整测试集合、已有失败及所需环境；旧失败若无关且已独立复现可登记后继续，涉及当前任务则先修。不得因测试总不全绿无限滞留B0。依赖B0表示该子项需要的执行环境基线，不要求未消费的所有外部服务同时就绪。D1也按真实消费者逐项落表，不提前搭尚未使用的完整平台。

| ID | 依赖 | 范围与具体交付 | 必须观察到的完成证据 |
|---|---|---|---|
| B0 | 无 | 核对HEAD/脏文件/工具链/实际依赖版本，冻结锁安装，建立现有测试和构建基线 | 命令、退出码、版本及旧失败分类；网络/环境缺失如实记录。历史计数不作本机结果 |
| S1 | B0 | 修既有executor/registry/protocol来源、parent、runKind、nullable period漂移，补输出校验和现有Spec的PlayPlan输入绑定（模型revision绑定归N1）。**2026-11-06 Q-S13-1裁定**：执行预算归J1；来源/模型/skillVersion一致性核对与幽灵parent归N1+D1；fork/replay的内部深核对（Run真伪）归D1；空种子计划（不写inputs的族合同）为S1合法语义、N1收紧为修订绑定；once跨请求同planId冲突检测归D1持久计划层 | 先复现历史来源/血缘失败再修复；全部技能输出形状可校验，数值不变；错误/输入不匹配不放行（异源/幽灵parent/错版本按裁定移N1+D1，作为已登记缺口不阻塞S1）。15章19断言复验并保留旧失败材料 |
| A1 | B0 | 提取框架无关工具调用/回执/权限端口，AgentScope与现有SSE兼容；工具目录引用Registry，清理重复分发只做等价部分 | 同一科学调用通过端口和原执行器得到一致Run；错误、批次完整回填、未知工具、晚回执负例通过；不扩张agent.py意图正则 |
| A0 | S1,A1 | 用现有已解析文档/注册PlayPlan完成最小真实Qwen→科学工具→Run→继续决策，无需新数据库/检索服务；修会话隔离、回填关联与结果读取 | 两个不同session并发不串摘要；同session串行；工具输出保持有效结构并按引用读取大结果；真实供应商trace及结果依赖成立。凭据缺失只阻塞真实验收，不能用fixture签收 |
| D1 | B0 | 最小PostgreSQL迁移、内容寻址制品、Paper/Version/Parse/Anchor/Model/Run索引与workspace身份。**新增（Q-S13-1自S1移入）**：持久计划注册（once跨请求同planId异内容冲突检测）；engine侧落库校验（导入Run的技能级schema门）；fork/replay内部深核对所需的Run真伪账本（幽灵parent封死） | 一个真实上传消费者可写读；JSON/JSONL快照只读导入数量/hash可校验；切换单一写权威，回滚路径明确，无双向双写 |
| P1 | D1 | 包装现有PDF上传/Docling/VLM为版本化论文入库、解析重试、来源锚点与列表/打开接口 | 同文件去重但保留来源；同论文新版本并存；重新解析不破坏旧anchor；解析失败PDF仍能读；VLM页级精度明确 |
| J1 | P1,S1,A1 | 持久ResearchTask/JobAttempt/ToolInvocation/事件outbox，RQ+Redis或Valkey；先迁一个解析任务再接科学/Agent执行，资源分道、租约与幂等。**新增（Q-S13-1自S1移入）**：执行预算（限额、预留与结算）随持久任务体系实现 | API/worker分别kill重启、重复投递、取消、队列丢消息重投不多产Run；超时真正终止工作；断线事件续读。不是仅保存一条queued记录 |
| L1 | P1,A1,J1 | 有预算的标识解析、外部搜索/合法全文获取、已有文本证据检索、引用边；接入上一节最小工具链 | 真检索→身份→来源片段→可打开PDF锚点；限流/无全文/重复/来源缺边诚实处理；PAPER引用和AI推测关系区分。可选PaperQA/GROBID不阻塞基础链 |
| N1 | S1,P1 | 从paperSpec/Cortex扩展有来源Math IR：量、域、单位/无量纲声明、条件、未知、能力、可操作自由度，修订到PlayPlan映射。**新增（Q-S13-1自S1移入）**：模型修订与来源/skillVersion一致性绑定（异源fork拒绝）；空种子族计划收紧为修订级输入绑定 | 非预制公式与N态系统/约束对象可表达；来源冲突/缺初值/奇点/非法域不执行；确认不是LLM一句“合法”，原文可回查；检查逐模型scope与AST Error节点，当前model.solve只接受已支持的自主系统，显含时间/刚性等先拒绝或匹配经验证的其他能力 |
| A2 | A0,J1,L1,N1 | 真实Qwen研究循环，来源/模型/实验工具选择与真实结果回填；任务检查点、人工问题、取消、预算与续跑 | 给中间结果不同的真实输入，后续工具/参数随之改变；至少一轮主动查证与科学执行。provider中途失败不假SOP成功；缺凭据实测不得签收 |
| U1 | J1,N1,A1 | 论文库入口→真实PDF/模型/实验纸；三模式共享引用；Agent过程与问题入口；持久CanvasCommand+ack及研究时间线 | 单浏览器实际上传、选对象、执行/对比/trace、刷新恢复；离线重连无重复Fork/纸；source定位、pending/失败明确；无聊天墙/新万能Store |
| C1 | A2,U1 | 首个完整论文研究切片：入库→必要检索→模型→自主实验→画布→刷新/续研究 | 一套真实来源、供应商、工具调用、Run、应用ack和恢复证据；旧Kakeya/公式主路不回退。这里还不能称游戏产品完成 |
| W1 | S1,N1,A1,J1 | World程序/Blueprint/Action/Goal ABI；Host转换、Gameplay与受保护状态、revision/权限/配额/幂等；沿用科学执行器 | 伪Run/事件、他人实体、旧revision、guest改预算/Assessment均拒绝；合法动作产Run并原子提交。生成Goal冻结后独立只读执行 |
| W2 | W1 | TS完整诊断→guest JS→QuickJS专用Worker，锁实际包/variant、资源与输入输出限额、同步step显式状态 | 实际WASM/Worker/CSP运行；新状态机可执行；死循环/内存/消息爆炸有界退出，释放资源，恢复重放一致；不许任意宿主引用/fs/net/timer |
| W3 | W1 | 注册SPD几何/support/变形/整段动作检查与PlayPlan；同一transition驱动Host、有限Solver、独立Goal和Replay | 代数/几何oracle、途中碰撞、非法动作、错误Run/假通关负例；solver有见证或unknown，不伪称证明无解；盲测私有Q/mesh不泄漏。此项先验纯Host，不依赖VM |
| A3 | A2,W2,W3 | Qwen生成→compile→playtest→诊断→revise；导演读玩家公开历史给提示和验证下一关 | 同一SPD生成“变形通闸/探针盲测”不同状态机，不给完成脚本；至少一次真实错误修复；VM完整Replay与独立Goal过；下一挑战发布前重新验证、当前规则不变 |
| U2 | U1,W2,W3 | R3F/Koota单一动态世界投影、输入/相机/对象操作、反馈/重试/回放；tldraw论文进入/退出及资源回收 | 单浏览器真输入完成观察→猜测→操作→响应→判定→反馈；参数/公式/几何同Run、返回原文历史；无重复实体/订阅/旧回执覆盖。开发夹具不代替真实生成 |
| E1 | C1,A3,U2 | 贯通真实PDF→模型→生成修复→玩→提示→下一挑战→Replay/论文历史 | 两种同模型程序有机制不同的trace；删除关键行为改变可达/可观测结果；版本/动作/Run/Goal可复现；代码独立复核与实际操作均通过 |
| X1 | E1 | 同协议扩到函数与动力系统，各自拆子项；复用编译/Host/UI/导演，注册所缺能力 | 各有一例非新专属页面：公式改变真实轨道/地形；原ODE只改合法初值/参数不暗加力。奇点/穿越/误差与unknown受检；跨论文可比性及新行为Replay |
| O1 | E1 | 发布前收口：旧主路回归、现有鉴权加workspace归属、输入/预算限制、故障恢复、备份恢复、依赖许可、生产bundle/模型工件与启动说明 | 新旧API实际真算；重启/恢复演练；前端无秘密、越权拒绝；构建产物与源码能力一致；恢复Run/来源可查；单目标本机生产包验收，不执行云部署/多端电池 |
| E2 | X1,O1 | 产品验收与交接：公开支持范围、剩余限制、运维/开发恢复入口；有证据替换的旧路径清理 | C1/E1及跨模型与恢复证据可定位；文档和实现一致；没有伪造进度、无限修复环或只靠fixture通过的必需能力；发布待授权不冒充已上线 |

优先顺序为B0相关基线→S1现有执行合同→A1→A0早期真回合，再推进D1/P1/J1/L1/N1并收口C1；A0缺凭据时直接选择后续ready项。C1后收口E1；W1/W2/W3不硬依赖C1，真实模型凭据受阻时可推进。不得因为A2受阻把A2标完成，或不断新增UI掩盖核心阻塞。每次切换都记录解除依赖的下一具体动作。

### 4.1 可执行步骤（实施合同，不是完成勾选）

每个工作包拆为三步，沿用上表硬依赖；默认后一步依赖前一步done，首步依赖上游工作包完成。B0环境门按LOOP的例外处理。跨包提前消费某一步产物必须显式改依赖并独立复核，不凭“可以并行”跳过集成门。步骤未出现在STATE时默认为todo；STATE只登记已开始、完成或阻塞的子项，不再复制63行空进度。

每步开始前填LOOP的开工卡；大到无法独立验证时再拆一个层级，如J1.2a，保持原完成门。下表的产物不是要求另写一份文档：优先是实际代码、迁移、测试和可定位的运行证据。

| 工作包 | 第一步：输入→改动→验收 | 第二步：接通真实消费者 | 第三步：失败边界与收口 |
|---|---|---|---|
| B0 | B0.1 按代码地图核对HEAD/脏文件、锁/工具、PDF与Agent/Run/UI链、源码/once/bundle选择，列受保护修改；完成研究导读与现状差异，形成基线清单 | B0.2 冻结锁安装Node依赖；先核对收集范围，排除研究归档的上游测试且保留全部现有产品测试，再跑vitest/build记录退出码/旧失败；不升级锁或缩测试躲错误 | B0.3 按server说明建Python环境，固定pytest集合，记录解析工件/服务/供应商配置存在性；缺服务只影响对应环境门，不输出秘密 |
| S1 | S1.1 用现有真实求值/fork复现source与parent丢失，最小修正透传；验证数值不变、来源和血缘一致 | S1.2 校准registry的runKind/nullable字段与JSON/二进制制品边界；验证NaN TypedArray拒绝、返回后改原buffer不影响证据，序列化保留dtype/shape/hash；错误输出不得进入图表/Goal | S1.3 绑定当前Spec的规范输入、source/parent和预算；拒同plan异输入、公共replay绕门；复跑历史19断言及受影响主路；源码修复须覆盖实际选中的once/bundle制品，不能只验src |
| A1 | A1.1 从现有Registry导出科学工具合同，保留原API调用；同参数经工具端口与原executor的结果语义一致 | A1.2 接统一invocation/operation/回执；当前单用户部署使用服务端命名空间，拒同键异payload/未知工具；持久化延后J1，不能宣称跨重启幂等 | A1.3 接AgentScope回填/SSE与baseRunId/expectedExperimentRevision；拒绝技能错配，不暗改op，错误批次完整返回；同调用不重复Fork，晚响应不改目标 |
| A0 | A0.1 消除全局摘要，session串行锁随生命周期释放；两session交错执行不串结果，异常后锁可再次取得 | A0.2 大结果用结构化摘要/制品选择器，保留完整受权结果；覆盖超过旧8000字符的输出，JSON有效且有完整性标记 | A0.3 有限预算真Qwen多回合：a=1→设3→选该Run乘2得6，显式选原Run则得2且parent正确；“连续研究”仍真调用模型，固定扫描显式工具化；无key仅真实验收blocked |
| D1 | D1.1 为现有上传消费者接内容hash、Paper/Version与workspace索引，实际数据库往返与同文件去重；不提前建全部未来表 | D1.2 只读导入旧doc/Run快照，保留ID与legacy来源精度，核对数量/hash/断链，迁移可重复执行且不造新Run | D1.3 切换该消费者唯一写入路径，演练中断和切换后数据导出恢复；确认旧JSONL不再承担同数据的写权威 |
| P1 | P1.1 上传与打开复用现有入口，建立版本列表/来源；解析尚未完成或失败时仍能读取原PDF | P1.2 Docling/VLM产物带parser版本与锚点精度，重解析产生新artifact；旧anchor可打开，不将页级来源升级成字符级 | P1.3 校验重复PDF、同DOI不同版本、失败重试、缺全文；接入一份真实PDF并完整trace，不以fixture声称新解析验收 |
| J1 | J1.1 用一个真实解析任务落task/attempt/outbox；实际worker消费，queued状态可重启重建；先不上全部队列 | J1.2 每计算worker独占引擎进程，接Run提交/幂等/租约/fencing；长算期间查询不杀计算，取消不误杀其他worker；桥不隐藏重试，提交前后断进程无重复可见Run/Fork | J1.3 接有界Agent activation与waiting_input检查点、资源分道/取消/reconcile；等待不占worker，旧attempt不可提交，事件cursor可续读；共享解析按消费者关系复用，单tab退出只解除该消费者，不能误杀其他订阅者的任务 |
| L1 | L1.1 先接一个可用检索provider与标识解析，按需补其他服务；返回身份/检索来源/限额，429不是空搜索结果 | L1.2 合法获取全文→P1解析→已有文本证据检索；同一片段可定位原文，错误/不完整覆盖明确；先不引入额外向量服务 | L1.3 明确引用边与AI关系分开；用小语料正例/干扰项评估相关片段是否被找到，保存漏检，决定PaperQA/GROBID是否真有接入必要 |
| N1 | N1.1 扩展paperSpec候选工具合同，支持域内未预装专属模型的PDF可由解析或已有工具产候选，不要求A0/A2先完成；方程/角色/条件绑定来源或用户选择，人工纠正留before/after；完整Agent链归A2/C1 | N1.2 确认记录绑定PDF版本/原文区域/转写/核对方法/差异；负号或上下标误识别但AST合法的候选不得自动确认，修订留痕；再匹配能力/Plan与输入，缺条件或不支持能力拒绝 | N1.3 普通合法调参保持modelRevision，仅更新Runtime参数/计划/Run；方程、假设或允许域改变才建模型修订并复用内核，验证旧Run可追溯、缓存不串模型、模型缺条件时能提出准确问题 |
| A2 | A2.1 把L1/N1/J1接入A0端口，按研究/生成/导演权限配置上下文，来源与科学结果分区；论文文本不能注入工具权限 | A2.2 真Qwen查源→实验→读结果→改变下一动作；用事先定义的可观察结果依赖判定自主性，不要求随机模型每次生成同一句话/同序列 | A2.3 持久消息/工具批次检查点；批次未执行、部分完成、完成未回填三处kill后无孤立tool result/重复副作用；必要时批次边界重建activation；等待释放槽、回答验revision，provider失败不伪装完成 |
| U1 | U1.1 论文库与原PDF进入既有桌面，参数在公式/对象内操作；所有科学组件按runId投影，显示preview/正式结果区别；修run3dStore输入快照/generation及几何-指标同代发布，measure失败不可假resolved | U1.2 Agent状态/问题/历史与CanvasCommand接通，收到浏览器应用ack才标应用完成；失联命令保留，冲突展示具体对象 | U1.3 真指针操作、Fork/Compare/Trace、刷新重连/重复事件去重；三模式恢复同一实验，Console与资源释放检查 |
| C1 | C1.1 选择支持域内未预装专属模型的真实PDF，冻结来源/问题；必须展示parseArtifact→Agent候选→校验/纠正→确认revision→Plan→Run，不以手工paperSpec替代；遗漏条件不得擅补，含合法AST误转写的忠实性负例 | C1.2 单浏览器完成上传→研究→Run→画布→trace；保存同一task下的工具回执与UI ack，不能拼接不同运行截图 | C1.3 刷新/重启后继续同研究，再验旧Kakeya/公式主路；所有必需证据和独立review具备后收口C1 |
| W1 | W1.1 明确World/Action/Goal/事件DTO、Host与guest写权限，先用已有科学Skill接一个事务消费者，不等SPD新runner | W1.2 候选转换/只读Goal/预留/提交接通；新revision竞争拒旧回包，失败Run/伪回执不能计分，资源实际消耗不回滚 | W1.3 状态/事件/Run引用落入D1/J1同一持久回执链，按revision恢复；一个attempt一个权威Host，受权读取不泄漏私有实例 |
| W2 | W2.1 锁QuickJS制品并复用同ABI：本地探索用浏览器Worker；严格盲测由服务端可终止隔离单元执行冻结step/Goal，客户端仅发Action；拒伪造state/解锁，验context/执行单元释放 | W2.2 显式guest DTO+seed/tick+有界意图接W1；新VM重建可回放，不依赖闭包/Date/环境随机 | W2.3 死循环/内存/深层消息/事件风暴/伪回执负例有界失败，CSP与实际构建可用；记录开销而非许诺实时帧率 |
| W3 | W3.1 从确认SPD模型注册几何/support/合法变形能力，经同一executor产Run；独立代数oracle校验，拒非正定/病态超限输入 | W3.2 先纯Host验证整段动作与Goal/失败轨迹，确定游戏额外机制；私有Q由服务器持有，公开接口仅返回合法观测 | W3.3 有限搜索与同transition纯Host回放给见证或unknown，生成程序新VM重放归W2/A3；盲测另验只读公开历史的基准策略，不可区分且答案互斥的实例拒发布；Replay覆盖动作/预算/时钟/待决状态 |
| A3 | A3.1 给真实Qwen模型/能力/任务约束而非完成程序，生成版本化源码，经compile→playtest取得诊断 | A3.2 修复诊断并新VM重放；同SPD两种机制trace不同；如果自然生成无错，可对真实生成制品做标注故障注入验修复，不伪称模型自己犯错 | A3.3 导演只读公开行为与Run给提示/提出下一关；下一关重新验证后发布，当前规则冻结；提示不能漏私有答案 |
| U2 | U2.1 同R3F页面按Run几何与程序实体投影，Koota有界owner、相机/输入归属明确；试运行时可用标注夹具 | U2.2 对象抓取/公式编辑→Action→真实Run→反馈；新几何与碰撞代理版本一起生效，拒绝回到最后合法状态 | U2.3 完成重试/回放/进入退出/返回来源，验证两玩法同页面；StrictMode/切换/销毁不留实体或GPU资源；夹具不替代A3 |
| E1 | E1.1 固定来源模型与预算，使用A3真实生成的两份程序创建attempt；输入与目标不同机制可辨识 | E1.2 真操作经历观察/猜测/动作/响应/判定/提示/重试及下一关；独立Goal和实际Run逐次关联 | E1.3 回放/断线恢复/论文历史及关键行为删除负例，收口整链；证明机制可运行，不宣称已证明趣味或教学效果 |
| X1 | X1.1 函数世界：复用ABI生成新行为，曲线/轨道来自Run；限制域、奇点与采样误差，附加运动规则单独声明 | X1.2 ODE世界：只改允许初值/参数，短时轨迹事件经误差检查；未经确认不加控制力，unknown不通关 | X1.3 各选有来源案例，经同编译/Host/UI/导演与Replay；跨论文比较先查共同条件，新增专属页面不能签收复用 |
| O1 | O1.1 用实际构建产物复验新旧引擎入口、WASM/解析工件及启动；前端无密钥、资源读取与workspace权限实际拒绝越界 | O1.2 数据库/制品备份与恢复、队列/worker/API失效演练；验证取消/费用/幂等/历史完整，失败可定位 | O1.3 固定生产构建与版本、许可/配置/回滚说明，单目标本机验收；实际部署独立授权，不借此开多端电池 |
| E2 | E2.1 逐项核对C1/E1/X1/O1证据与支持能力表，标出known limits/unsupported；缺必需项不降级成完成 | E2.2 在确认替代和无消费者后清理旧路径，跑对应回归；按实际实现更新入口和恢复说明 | E2.3 交付可复现产物/证据索引/恢复点与剩余问题；本地验收、可发布、已部署三个状态分别报告 |

### 4.2 首批开工顺序与验证入口

优先B0.1→B0.2→S1.1→S1.2→S1.3；A1所需Python基线B0.3就绪后推进A1.1–A1.3与A0.1–A0.3。不为首批任务先装数据库、RQ或QuickJS。A0.3无凭据时保留其blocked，选择D1等ready项；S1未通过时可做不消费其结果的A1协议工作，但不能签收S1或A0。

现有定向检查入口（开工时核对路径，以下不代表已经运行）：

- S1：`pnpm exec vitest run src/skills/executor.test.ts src/skills/registry.test.ts src/skills/playPlan.test.ts src/experiments/protocol.test.ts`；新增回归纳入同一入口，阶段收口再`pnpm test`与`pnpm build`。
- A1/A0：隔离venv下`python -m pytest server/tests/test_agent_tool_surface.py server/tests/test_agent_server_mode.py server/tests/test_agent_lane_b.py server/tests/test_agent_provider.py server/tests/test_engine_api.py`；协议测试可使用mock，A0.3另跑真实服务回合并记录调用链。
- P1/J1：在现有`test_ingest_hardening.py`、`test_ingest_isolation.py`、`test_session_recovery.py`等相关测试上补真实恢复负例；不能只沿用旧测试就宣称新的数据库/队列恢复通过。
- 后续模块的新增测试文件在该子项开工卡写明，先确定关键行为/负例再建文件。按实际依赖启动服务；没有UI改动不跑浏览器，只改文案不跑产品电池。

每个检查点只维护一份精简证据索引：输入与版本、来源/模型/程序hash、执行命令与结果、关联task/operation/run、UI路径与应用ack（若涉及）、失败负例、独立review和限制。索引引用原日志而非复制；不记录密钥或完整用户隐私材料。已有证据仅在相关输入/代码/依赖/配置发生变化时失效。

## 5. 首个游戏的开发合同

来源确认的SPD二次型(x-c)ᵀQ(x-c)≤1。科学模型拥有Q的正定性、几何/support与合法域；游戏另声明门、动作代价、有限搜索空间、信息与目标，不能伪称论文原有规则。

- **变形通闸：**观察两闸与椭球，提出姿态/允许参数变换，Host先验整个动作路径及约束。合格Run更新几何；穿过两闸且满足冻结约束才成功。碰撞拒绝给对应原因，保留上次合法状态；可重试、比较和回放。
- **探针盲测：**同一模型能力与世界Host，仅更换生成行为程序。玩家在有限探测预算下选择方向，从真实support回执推断几何，再提交过闸动作。私有Q是登记的游戏实例参数，不把它冒称论文给定常数。严格盲测由服务端Host持有Q与seed，浏览器/guest/导演只拿获准的观测回执，不能下载完整Run、mesh、模型参数或答案日志；所有读取接口同受权限约束。每个attempt固定一个权威Host：严格盲测由服务端从权威状态执行被冻结step、科学动作与Goal，客户端只提交Action，不接受客户端GameplayState/解锁结果/Run/分数作为权威；本地探索使用浏览器Host并显式标注其信任范围。严格模式断线暂停新权威动作，重连查询同operation回执，不能切本地Host续分；本地探索仅在能力与制品已缓存时承诺相应离线范围。纯浏览器模式只能提供教学遮蔽，不能宣称对本机调试者保密。目标不能仅靠调松阈值完成。

Solver在相同Action/transition与预算下找见证，并由独立oracle/Goal复验；搜索失败返回unknown或具体反例。发布挑战还须检验初始即胜、恒真/恒假Goal、无效动作和可行失败轨迹，不能只有一条LLM声称成功的脚本。盲测发布另验公开观测策略：在声明的有限实例集/参数子域内，策略只凭公开历史选择动作；知道私有Q的路径不是玩家信息条件下可解的证据。不可区分实例须接受共同合法等价解，否则增信息/减自由度；预算内相同观测却要求互斥答案的负例须拒发布或修正规则，未知保持unknown，不搭通用POMDP平台。挑战性用候选动作数、最短已知见证、信息需求和玩家尝试来估计，不把有限搜索最优称为全局最优。Replay绑定模型/程序/规则revision、引擎版本、seed、动作、Run与判定回执；自由探索允许无Goal运行相同模型，挑战模式加冻结Goal/预算，数学真值不另建一套。

## 6. 验证、范围控制和清理

现有入口：pnpm exec vitest run <相关测试>、pnpm test、pnpm build；Python依server/README.md隔离venv执行python -m pytest server/tests/<相关文件>。B0先核对真实版本/锁文件；不要沿用AGENTS旧测试计数、临时缩小“全量”或升级来躲失败。涉及引擎就实际跑Node桥，涉及供应商就记录真实回合，涉及UI就单浏览器真操作和Console。只改文案不跑产品测试；不重复已有效的全套检查。

DSH保留受限试点而非交付硬依赖：只有相同工具面上的真实Qwen/错误/取消/恢复对照、可删除代码与维护收益成立，才另提迁移；不能为等待它卡住A2。PaperQA2、GROBID、pgvector/Embedding/Rerank、连续Episode也只在实测缺口与真实消费者出现时接入；本计划没有把它们全设为新平台依赖。

每次只引入当前子项必需的模块；新增接口必须有消费者与失败语义。替代旧路径后查import/动态注册/路由/脚本/测试/文档，确认无消费者再单独审阅删除；不删用户脏文件、失败证据、负例或锁文件。当前研究约33MB含复现与失败账本，不能因“旧”判垃圾；xyflow与tldraw仍分别服务现有路径。清理候选记STATE，不开一条无休止的重构主线。

旧M0–M9全部未执行，本次由B0–E2取代：M0→B0，M1→S1，M2→W1，M3→W2，M4→W3，M5→A3，M6→U2，M7→E1，M8/M9→X1。没有把旧计划升级为已完成功能。

按需查来源：[Agent](docs/research/playable-mathematics-2026-11-02/02-harness.md)、[论文与任务](docs/research/playable-mathematics-2026-11-02/04-library-jobs.md)、[领域合同](docs/research/playable-mathematics-2026-11-02/05-system-contracts.md)、[历史执行缺陷](docs/research/playable-mathematics-2026-11-02/15-mathworld-execution-evidence.md)、[引擎决策](docs/research/playable-mathematics-2026-11-02/16-game-engine-decision.md)、[生成程序](docs/research/playable-mathematics-2026-11-02/17-generative-world-program.md)。研究文档是依据，PLAN是实施合同，STATE是进度；不每轮重读白皮书。

## 7. 本次审查定位（2026-11-05，源码静态证据）

这些缺口已进入任务合同，**尚未修复生产实现**。历史研究RUN保持原样；源码存在某能力不等于当前环境验收通过。

| 发现与影响 | 当前代码依据 | 修订与实施归属 |
|---|---|---|
| 科学输出有来源/血缘及schema漂移，不能直接成为游戏判定事实 | src/skills/executor.ts:1005调用evaluate未传opts；model.solve返回period0可为null；registry与实现需同验 | S1先修来源、schema、输入绑定，N1扩模型修订 |
| Agent跨会话摘要共享，大工具回执按8000字符截断可能成为非法JSON | server/agent.py:1027使用global _last_ok_summary；工具回填在1084附近截断序列化结果 | 新增A0早验真实回合；session-local状态、同session串行、结构化分页/制品引用；不能只改提示词 |
| requestId只在进程缓存中去重，没有payload绑定，重启后不能保证去重 | server/engine_api.py:65–82 | A1拒同键异输入，J1实现持久操作回执与旧attempt提交拒绝 |
| Run持久化是best-effort且只保存resolved，不能证明故障账本/持久成功 | scripts/engine_persist.ts:persistRun/restoreRuns | D1/J1区分计算成功与持久提交，保存失败attempt及其错误；JSONL迁移禁止双写 |
| 重启恢复只把pending/running转error，queued可能留下但无人执行 | server/main.py:_restore_jobs | J1覆盖queued重建、lease过期、waiting_input释放槽位和取消竞争 |
| 早期要等完整存储/检索/模型层才能验证真Agent，集成风险暴露过晚 | 前版A2依赖A1/J1/L1/N1 | A0先消费现有真实执行器；A2仍承担完整研究与恢复，未降低C1验收 |
| 仅隐藏mesh不能防同浏览器读取私有Q；世界先提交再判定会留下半成功状态 | 前版§2/§5合同缺口；17章已有候选状态与权限边界 | W1/W3明确权威执行位置、公开回执与原子Assessment提交，资源费用独立结算；W2限定可验证profile |

技术路线仍沿既有源码研究，未重新评选框架。本轮是整套方案和关键调用链的审查，不是逐文件生产代码审计或新的运行测试。

完整原目录已实际迁入研究materials/original-folders，包含上游仓库测试。当前vite.config.ts未声明test include/exclude；B0.2须先证明测试发现只消费本项目既有测试集合，研究资料不能进入产品构建/依赖/测试收集。不删除或藏起产品失败来达成隔离。tsconfig当前仅include src/scripts；无需为搬资料迁移框架。

## 8. 白皮书与源码使用入口

首次进入按[代码地图](docs/development/codebase-map.md)梳理现状，导读研究正文与02/04/05/06/12–17的相关合同；已读范围/已实现差异随B0.1记录，不另开泛研究。代码整理随S1/A1/U1/J1/O1的真实消费者推进，无替代和回归不批搬删。执行每步前按[设计—源码—任务索引](docs/research/playable-mathematics-2026-11-02/development-source-map.md)定位原文及固定源码；记录支持结论的函数/类型、版本与未验证项。旧PDF、早期schema、README宣传和HTTP可达性都不能替代这一步。无需每轮重读所有白皮书，但直接依赖的实现不能仅凭本计划摘要编写。
