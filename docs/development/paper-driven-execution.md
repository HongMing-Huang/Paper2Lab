# 当前研发方案：陌生论文 → 问题驱动计算 → 可操作世界

2026-11-07。用户最新范围覆盖固定论文、固定三关、“方向之室”或“搬针过弯”优先的临时安排。本轮只调查和更新研发文档/任务，不修改生产代码、不运行重计算或付费推理，不签产品完成。原21个工作包、W1/W2/W3/A3及C1/E1/E2继续有效；案例用于验证，不能取代生成能力。

## 1. 已核实的代码与缺口

| 路径 | 当前事实 | 下一增量 |
|---|---|---|
| `src/desk/Home.tsx`、`src/study/*` | 最新源码已改为上传立即`onStudy`，PDF文本/按页读取、候选、Node任务与Run→世界交接已有增量；首页仍列六个独立入口 | 保留这些增量，核验实际产品；首页与Agent入口收敛，不能按旧“等待全文”结论重写 |
| `src/ingest/upload.ts` | 已有202提交、轮询、阶段/elapsed、刷新重接；最终才拿完整document | 用同一task发布可用片段及覆盖范围，不另建解析任务系统 |
| `server/vlm_parse.py` | 先渲染页面，最多24页，4路VLM并发，`gather`后归一化；有总duration，无完整分段 | 按问题选页/区域、逐片段提交，有限预取；渲染和推理独立计时 |
| `server/ingest_worker.py`、`ingest_runner.py`、`ingest_core.py` | 已有常驻可杀Docling进程和converter缓存；当前`convert_pdf`整篇转换、公式富集 | 复用暖进程，增加受控页范围；阶段计时不得把warming当真实模型首推理耗时 |
| `src/skills/adapterRouter.ts` | 有Kakeya标题关键词及公式/ODE结构路由 | 从新论文主路径移出模板选择；保留专用案例和明确回退 |
| `server/engine_api.py` | once bundle存在时每请求spawn Node；常驻bridge仅fallback | 同输入、同制品做冷暖对照后选执行策略 |
| `server/node/{api,worker,engine,ledger}.ts` | 已有pg-boss任务、独占候选进程、lease/fence、PG原子Run与回执 | 补可观测阶段、有效结果复用及资源准入，不另造队列 |
| `server/node/dsh/*`、`src/desk/agentBridge.ts` | 新DSH科学工具与旧桌面SSE入口仍分离；DSH现工具主要是Run执行/读/比较 | 同研究ID接入片段/意图/模型候选，再接真实世界工具 |
| `src/mathworld/*` | 有公式/ODE本地Host、Run/Goal、三维控制和JSON编辑；开发样例不是陌生PDF生成 | 从确认模型/Run接入能力及受控World Program，不能按mechanicId固定分流 |

已安装Docling `DocumentConverter.convert`有`page_range`参数，但当前产品未透传；先核页号、全局bbox和部分产物合并，再接入。不能把新官网progress callback直接当本地2.131已有流式接口。PDF.js已有逐页`getPage/getTextContent/render`；扫描件无文本不能冒充已识别。

## 2. 性能证据与计时合同

目前没有可支持“主要慢在数学求解”或“常驻一定更快”的分段数据。本轮不跑benchmark，缺值明确待测，不用代码注释中的毫秒数当实测。

| 阶段 | 已有观测位置 | 当前可得/缺失 |
|---|---|---|
| PDF打开/首屏渲染 | Home blob预览；PDF视图 | 缺首屏呈现与逐页渲染span；建blob URL不是渲染完成 |
| 上传/排队 | ingest elapsed、任务created/started | 可见整体经过时间；缺明确上传完成/资源等待拆分 |
| VLM页图 | `render_pages`、`asyncio.to_thread` | 缺逐页渲染/编码/bytes计时 |
| VLM/Agent推理 | VLM总duration、DSH通知/usage | 缺请求开始、首内容、响应完成及工具等待拆分；未配置供应商记未测 |
| Docling | warming/parsing通知、历史J1.1解析记录 | 历史约57–59秒为整链运行记述，不是分段基准；缺模型初始化/实际转换独立span |
| Node启动/内核初始化 | engine进程wallMs、engine.started、once入口 | 缺spawn→ready、动态import、实际使用的CAS/WASM初始化及compile拆分；不能假定每个Skill都会加载全部内核 |
| 数学求解 | `executeSpec.durationMs` | 包含compute、封存与输出校验；部分compile在计时前，不等于完整数学请求 |
| 数据传输/持久提交/呈现 | HTTP、JSON、PG事务、UI接收 | 缺序列化、bytes、发送/接收、提交及UI可操作span |

每次操作沿用requestId/taskId/attemptId/operationId/runId，附阶段名、同进程单调起止、cold/warm、cacheHit、输入digest、源码/内核版本、页/采样/步数、bytes和状态。跨进程保留各自持续时间及关联ID，不直接相减不同performance.now；重叠阶段不重复求和。错误、取消、超时也结束span；不记录密钥或完整论文正文。

后续开发先在既有任务事件/回执metadata和浏览器Performance边界补计时，不安装遥测平台。记录CPU峰值/RSS和队列等待；比较轮次少而可解释，不能以总HTTP耗时扣Run.duration就声称得到纯启动耗时。

同一真实计算请求对照：当前once候选路径；已存在bridge的冷首请求/暖后续；如bridge职责不兼容持久提交，则先在隔离计算比较中评估，不直接接生产。固定输入、治理plan、内核制品、并发和缓存状态，数值/误差一致；冷启动与重复各记录样本和范围，不用单样本宣称p95。

若初始化显著：优先每个科学worker独占一个可终止的暖引擎，失败/取消杀掉该引擎并重建；计算仍只产候选，PG/fence仍决定正式提交。不得多个任务共享不可独立取消的全局引擎，不恢复bridge隐藏重试或健康检查排长算的问题。若真正瓶颈在求解/图像/传输，则优化对应阶段，不以统一语言为理由迁移。

## 3. 第一个纵向结果：新PDF与渐进研究

上传立即打开原PDF和同一researchSession，先展示“可读页/正在分析页/尚未分析页”，Agent问用户关注的问题。已获得文本可提取标题/摘要并注明页来源；只有文件名或空扫描文本时先问研究意图并说明尚未读到内容，不能假称理解论文。

浏览器优先抽可见页文本（普通文本只作定位候选，数学公式不能靠碎片文本自动确认）。用户选中公式/区域或提出问题后，Agent请求相关页及定义/假设所在上下文；需要时再读引用页面。页图/VLM处理扫描和复杂公式，Docling提供结构化精读/锚点。避免全篇同时跑两种重解析；不同解析来源的锚点精度与差异保留。

片段不可变地绑定PDF内容hash/版本、页/区域、parser及版本、覆盖范围、识别质量与revision；沿现有parse artifact存储扩展，不覆盖完整产物或伪称整篇完成。片段通过既有outbox/任务查询可见；失败页不抹掉其他有效页。任务在后台继续，不要求全部页面成功才对话。

刷新恢复用服务端文件/论文ID与任务；本地blob只管当前预览。共享解析按消费者取消，退出一个tab不杀别人的解析。新任务进入同PG领域账本；legacy已有RQ消费者不盲目迁移，部分读取支持用同任务/attempt体系扩展并避免双写。

## 4. 第二个纵向结果：意图变成真实数学任务

复用paperSpec→PlayPlan→Registry，不建另一套Math IR。候选必须包含：问题/求解目标、数学对象及表达式、变量角色、参数、定义域/单位、假设/约束、输入/初始边界条件、期望observable、精度与资源限制；每项标论文锚点、用户提供或尚缺。合法AST不等于忠实转写，负号/下标/条件要能回看原页纠正。

Agent提出候选，能力匹配按数学结构与Skill实际支持域进行，而不是按标题/关键词或固定mechanicId。未知符号、初值缺失、非自主/刚性等不支持能力返回needs_input或unsupported及具体字段，不填默认值假算。论文未指定但实验需要的选择，由用户明确提供并记录为实验假设。

确认当前模型revision后形成规范请求，绑定source、modelRevision、inputDigest、Plan及父Run，走现有Node operation→task→worker→真实核→输出/质量校验→原子Run/receipt。UI显示queued/running/resolved/error，并映射底层succeeded/failed/cancelled/waiting，不改数据库状态名造第二状态权威。阶段完成度来自事件，不显示假进度。

幂等operation防重复副作用，与计算缓存分开。缓存键包括workspace权限、数学语义/模型revision、规范输入、seed、精度/算法/内核制品版本；只复用成功且满足本次质量要求的结果。每次请求保留自己的回执、来源和reusedFromRunId，不能把别的论文来源伪装成本次。错误/取消/unknown不作为成功缓存；并发同计算去重仍保留消费者取消语义。先支持确定性Skill，非确定性能力按声明处理。

参数变化只失效真正依赖的派生节点，复用现有reactive cell图；不缓存错误几何或用旧Run覆盖新参数。任务侧先复用当前并发配置，再把Docling/VLM/Node/WASM的重任务准入统一到现有任务认领/租约资源约束；各服务各开一个Semaphore并不能形成全机总限额。首期保守限制重计算、页图预取和浏览器DPR，依据实际CPU/RSS调整，不新建资源调度服务。

## 5. 第三个纵向结果：论文结构生成可操作世界

确认模型与真实Run先暴露可用能力：可求值/积分/轨迹/几何/约束/可逆控制及其域与误差。Agent根据论文问题和用户意图提出世界实体、动作、行为、事件、Goal和反馈；不能只从三个小游戏选择，也不能把一条公式自动当作完整游戏。

保留W1的Host权威、W2受控World Program编译/隔离、W3有界验证、A3生成诊断修订路线。稳定的是科学接口与安全边界；允许生成不同实体组合、动作效果、目标阶段和交互过程。注册机制可作素材/回退，明确标签，不能冒充通用生成。缺科学能力则只运行支持的实验或说明缺口，不临时编造内核。

World Program只能请求经授权的科学动作/返回有界意图，不写Run、正式Assessment或修改当前冻结规则，不生成正式React页面。科学初边值/控制力必须忠实原模型；游戏新增规则单独声明。发布前验证动作有效、Goal非恒真、起点非已胜、有真实见证/可行失败；无法验证返回unknown。

拖动本地同模型低成本预览，按负载节流/合并；释放或稳定后提交正式任务。pending时旧结果标stale；仅当前revision的正式Run/质量与独立Goal更新可信结果，preview不计分。Agent在正式结算/用户提问/失败/通关时决策，不进帧循环。回放绑定模型/程序/规则/seed/动作/Run，场景投影不再积分另一套真值。

## 6. 实施顺序与现有任务

| 顺序 | 复用任务 | 产品退出结果 |
|---|---|---|
| 结果一 | CLI-108/112/105，保留CLI-146 owner | 未预装真实PDF立即可读；全文未完时Agent围绕有效片段询问；问题定位到公式/条件，形成可纠正候选 |
| 结果二 | CLI-145/146/105，CLI-149承接能力缺口 | 候选→真实异步任务→有效Run→界面；有分段时间、冷暖比较、缓存命中/失效和错误原因 |
| 结果三 | W1/W2/W3/A3、CLI-129/130/131/150 | 当前论文模型/Run驱动生成世界；可改变条件、失败重试、正式判定、继续探索，生成行为不是固定模板 |

CLI-151只汇总这三个真实产品结果。原Kakeya/搬针/SPD案例不删除，但不再是开工硬前置或唯一演示。第一条陌生PDF选支持域内、未预装专属adapter的论文；不承诺任意数学论文都可执行。先跑通一篇再用结构不同的输入核验通用接缝，不为每篇另开发页面。

每切片实施后实际运行同一产品输入→计算→输出；保留必要数学正确性/权限/恢复检查，优先既有少量校验和真实联调，不新增大量测试文件/复杂门禁。本轮只有源码和历史证据调查，不声称上述切片已完成。共享入口/Registry/schema/锁与生产文件由原owner串行交接；开发者按[根启动Prompt](../../DEVELOPMENT_PROMPT.md)执行，Linear状态回读，不另造进度表。

## 7. 当前产品入口、游戏复用与端侧接入补充

最新源码变化须在实施前回读：`Home`已立即进入`PaperStudy`；研究页已有真实askTurn输入但在长面板底部，`worldFromOdeCandidate`已能从候选/Run交接ODE世界，仍是非AI配置转换。MathWorld已有Kakeya编辑与搬针代码，且开始消费资产组件；这些不等于通用论文World Program生成。VLM/Docling/Node已新增部分timing代码，§2缺口是前次快照，后续先核已有span和真实日志，不重复封装。

**首页**只保留Paper2Lab、一个打开PDF主动作、居中的研究意图输入；解析引擎与开发案例藏入明确的开发/高级入口，不让用户选择六个Lab。初始问题随同一研究上下文带入，不能建一个无后端消费的输入框；没有论文时不假装已分析。已有未完成研究恢复作为必要次动作。

**同一个Agent小窗**贯穿论文和游戏：桌面居中、进入游戏后底部中央可收起，不占两侧长面板；最近回复/真实任务状态默认精简，完整对话/公式/Run/性能记录按需展开。复用`PaperStudy.askTurn`与既有服务端session/工具回执，不新建聊天后端。输入获得焦点时暂停游戏快捷键，Esc收起还原焦点；提交动作绑定当前paper/model/world revision，真正执行后才显示完成。

**删除展示而非按后缀删功能**：当前产品范围只有`index.html`、`mathworld.html`和素材`preview/index.html`三类。前两者是React真实入口，且`PaperStudy`仍跳转`/mathworld.html?handoff=...`；需先在同应用挂载世界并验证来源/状态交接，再删除不再使用的独立入口及构建配置。素材preview的HTML/打包JS可在正式场景接入、引用与构建命令更新后删除；保留来源/许可/必要历史证据。不得删掉HTML入口后把“页面不存在”称为产品整合。

**直接复用游戏能力**：R3F/Drei提供渲染、指针、对象控制和相机；已装MuJoCo仅在模型确需物理时消费，不能为显得像游戏额外施加论文没有的力。PuzzleScript源码的输入→规则→胜利、撤销/重开可作离散规则执行候选，接入须固定版本、保留MIT许可并验证真实消费者，不能直接把全局JS引擎塞进3D Host。SineRider作为数学→运动/接触→目标的参考，源码为AGPL-3.0，不能当成无条件可粘贴组件。优先已有资产与当前内核；不再换固定玩法取代生成路线。

**端侧模型**沿用`server/edge`与官方OVMS，先接Agent的已有论文检索：首选`Qwen3-Embedding-0.6B`官方OpenVINO制品，切片/索引绑定文档与解析revision；先CPU、后目标机GPU/NPU。重排可按需要用官方支持的`Qwen3-Reranker-0.6B-seq-cls`变体，不能把原始生成式reranker冒充该接口；首次先只接embedding避免同时加载多模型。Qwen3-0.6B INT4可用于短文本辅助，不自动替代DSH主导演；工具规划能力需真实回合验证。模型服务不可用明确降级为已有词项检索或已配置远端，保留来源、超时/取消/回退记录，不能生成假向量/假回答。端侧推理与浏览器3D渲染分开，没有Intel实测不报性能或实际NPU设备。

依据：[Drei控制](https://github.com/pmndrs/drei/blob/master/docs/gizmos/transform-controls.mdx)、[PuzzleScript执行](https://github.com/increpare/PuzzleScript/blob/master/src/js/engine.js)、[PuzzleScript许可](https://github.com/increpare/PuzzleScript/blob/master/LICENSE)、[SineRider许可](https://github.com/hackclub/sinerider/blob/main/LICENSE.md)、[OVMS embedding](https://docs.openvino.ai/2026/model-server/ovms_demos_embeddings.html)、[OVMS rerank](https://docs.openvino.ai/2026/model-server/ovms_demos_rerank.html)。这些是接口/复用依据，不是本产品完成证据。
