# 从产品操作到后端实现

2026-11-06 · SOURCE核查与DESIGN合同；无新服务/供应商/产品RUN。承接用户产品反馈与[体验/DSH决策](product-experience-and-runtime.md)。这是实现规范，不是已存在API清单。

## 1. 这次补的是哪些缺口

上轮只把“用户看到什么”和“模块负责什么”接在一起，没有确定StudySpace就绪视图、预测与Action先后关系、DSH进程所有权、生成发布、保存一致性和迁移写权。此次以一段完整旅程落地这些合同。桌面项目另有ZCode活跃主会话，STATE报告D1完成/P1推进；以下基于源码静态读取，不重新签收其运行证据、不覆盖其进度。

## 2. 明确采用的后端组合

Node/TypeScript + pnpm；Fastify承接产品HTTP/可信JSON Schema与事件端口，`pg`(node-postgres)连接既有PostgreSQL；官方DSH TS SDK驱动独立runtime，Qwen为模型；同一Registry/executor运行在受管Node科学执行单元。PDF.js提文字/坐标和渲染页面，受限VLM补转写/理解；Node页面渲染按[官方Node示例](https://github.com/mozilla/pdf.js/blob/master/examples/node/pdf2png/pdf2png.mjs)验证所锁pdfjs-dist、canvas原生资产和字体，不能直接把master代码套到现有4.10版本；图片/文本只是候选来源，模型确认另过门。

后台任务优先接pg-boss适配PostgreSQL，复用已有数据库，不加Python RQ或第二个Redis平台，不自己实现通用任务调度器。pg-boss只负责调度/投递，Paper2Lab保留领域task/operation/attempt/outbox、预算和写权。本轮一手源码候选pg-boss 12.38.1已核对，并非已安装/锁定；不在DSH/科学长任务外包transactional work事务。具体包版本、Node支持交集、迁移权限、锁定DSH SDK/runtime/plugin与实际WASM/渲染制品在首个隔离门验过再写锁，不以网页latest替换实际版本。

Fastify不是数学核，pg-boss不是领域事实，DSH Session不是Run数据库。先一个部署、两个角色（API、worker），按实际资源再拆；不建立八个微服务。拟用`server/node/`中的app、routes、services、repositories、workers、dsh-adapter逻辑目录，有消费者才建文件。共享TS DTO/Registry用现有源码；不预发布整套npm包。

来源：[Fastify验证](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)、[pg事务](https://node-postgres.com/features/transactions)、[pg-boss介绍](https://pgboss.io/introduction)、[DSH SDK](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md)。Fastify schema必须来自可信注册表/应用，不直接编译LLM上传的schema；模型/World DTO用固定schema校验，异步对象权限在应用层校验。响应序列化裁字段不替代数学输出验证。

## 3. 首次用户旅程：后端究竟做什么

1. 上传PDF成功后立即创建可恢复StudySpace，先返回可读原文与parse task引用；用户不用等Agent完整研究结束。正在解析、部分可用、需确认、可探索、生成中、可玩、失败分别是数据状态，不用假百分比表达。
2. 解析完成不直接长出全部卡片。`study.open`读模型给当前问题、少量候选对象、来源与就绪报告；Qwen只能提议哪些值得探索，不改变解析事实。
3. 用户选择对象后创建ExplorationIntent，冻结source/parse/model引用；系统查缺失条件与能力，必要问题挂该对象。缺条件不阻塞原PDF和其他对象，不退回首页。
4. 用户进入探索：合法参数变化经Plan与真实计算形成Run；选择挑战则需已发布WorldProgram及Goal。Kakeya首秀复用专用资产；SPD双程序验动态生成，不能把专用Demo签收为生成器。
5. 玩家先提交预测，再尝试动作。记录Prediction→Action→Run→Assessment的因果关系；揭晓结果后新预测标后见判断，不伪称事前预测。
6. 反馈由可信Run与冻结Goal产生；助手在请求提示/关键失败/阶段完成时读取公开上下文，给有引用的解释。用户继续尝试时旧提示标过期，不暗改当前规则。
7. 保存创建不可变checkpoint，恢复返回同世界/模型/程序/Run/事件游标及论文锚点。下一关独立生成并验证后发布，用户接受才创建新PlayAttempt；旧关完整保留。

## 4. 产品API：以资源与状态为准（DESIGN）

全走`/api/v1`，下表省略此前缀；旧`/api/ingest`等由兼容适配调用同领域服务，不能让新旧API写出两套事实。新路径并非已部署端点。

| 用户操作 / 路由 | 核心输入 | 返回与必须发生的副作用 |
|---|---|---|
| POST /papers/uploads | multipart PDF、幂等键、来源信息 | 受限流式写blob/哈希→提交PaperVersion/StudySpace/parse task与outbox；201或202回含original可读引用、taskId，不等解析完成 |
| GET /studies/:id | 认证workspace、可选已知revision | 聚合read-model：问题、paperVersion、parse status、对象候选、pending questions、入口/阻断原因、最近已提交Run/attempt；不得全局单一ready布尔 |
| POST /studies/:id/research | 问题、选中对象引用、expectedRevision、operationId | 202 + ResearchTask，持久意图后安排有界DSH activation；SSE连接本身不启动第二个Agent |
| GET /studies/:id/objects | parse/model revision | 少量有来源候选、允许自由度/支持能力/阻断项；同名符号不同来源不默合 |
| POST /studies/:id/object-selections | objectId、paperVersion/parseArtifact/candidateRevision、expectedRevision | 保存ExplorationIntent与版本绑定，返回可做动作/缺条件/阻断项；不在此偷偷执行昂贵生成 |
| POST /models/:id/confirmations | candidateRevision、转写核对/差异、选择/回答 | 校验版本和证据，生成确认修订与原因；确认失败返回missing/ambiguous，绝非LLM一句合法 |
| POST /worlds/proposals | modelRevision、意图/体验约束、公开能力、预算 | 202 draft task；DSH→compile→playtest→revise，产不可变program与validation report；不能自动作为当前关 |
| POST /worlds/:revision/publications | 已验validationReport hash、expectedRevision | 独立可信检查model/source/goal/program匹配及范围、权限与公开信息门，成功后published；未知不可发布挑战，可显式explore-only |
| POST /play-attempts | published world revision / exploration intent | PlayAttempt、冻结规则与初态、action capabilities、公共快照。未确认论文只能在标明的教学变体分支中探索 |
| POST /play-attempts/:id/predictions | attemptRevision、题目/观察上下文、预测 | 持久Prediction，返回createdBeforeAction游标；后续Action显式引用，可选跳过预测，不强制每次拖动写一条 |
| POST /play-attempts/:id/actions | clientActionId、baseRevision、Action、predictionId? | 202 + operation/action seq，或同步已提交回执；重复同键异输入409，迟到结果不覆盖；响应不接收客户端won/权威Run |
| POST /play-attempts/:id/hints | contextRevision、trigger/manual、等级 | 复用/创建有界任务；public view→DSH→结构化提示含Run/source引用。silent偏好/冷却/成本先校验，不因每一帧唤醒 |
| POST /studies/:id/checkpoints | expectedRevision、当前已提交引用、UI layout revision | 一次持久不可变checkpoint；pending科学Action仍pending，不将半结果存为成功。UI未ack显示布局未完成 |
| GET /checkpoints/:id | workspace/session身份 | 完整公共恢复manifest+版本/hash+eventCursor；私有Q/见证不下发浏览器 |
| POST /play-attempts/:id/next-challenges | 当前attempt及结果、用户偏好/接受意图 | 新提案/验证Job，发布后返回候选入口；用户确认开始才建新attempt，不能偷偷改旧Goal |
| GET /events?after=cursor | 认证stream范围；Last-Event-ID | SSE补发持久领域事件、再订阅新事件；过期游标返回resync_required与snapshot入口 |
| POST /tasks/:id/cancel、/questions/:id/answers | attempt/问题revision、幂等键 | cancel_requested或版本化answer；worker退出后才cancelled；过期回答409，不直接done |

用户身份从服务器认证上下文确定，不能相信body workspaceId来授权。单用户本地模式使用服务端固定workspace；任一资源读取/制品下载/事件订阅都按归属查询。写操作统一有operationId/idempotencyKey、canonical input digest、expectedRevision与有限预算；201/202、completed/accepted/needs_input/unsupported/unknown/错误分别返回。HTTP 409用于版本/幂等冲突，422用于合法性/缺条件报告，暂时不可用给retryAt，不把错误都包成200。

## 5. 最小数据合同与逐步落表

已有D1表不重建；同一个PostgreSQL权威库做加法迁移。以下逻辑对象按实际消费者落地，不一次建全。

| 数据组 / 首个消费者 | 必要字段/不变量 |
|---|---|
| 既有workspaces/artifacts/papers/paper_versions/upload_events；P1 | 保留既有ID与sha。当前papers以文件hash识别，新增逻辑论文identity/identifier映射后才表达同DOI多版本；不以标题相似自动合并，原上传事件保留 |
| ParseArtifact / SourceAnchor；P1/N1 | versionId、parser+version、inputHash、artifactHash、coverage/errors、page/bbox精度、text/region hash。旧documents按docId覆盖仅兼容读；新解析版本追加，旧anchor不被覆盖 |
| StudySpace / ObjectCandidate / ModelRevision；U1/N1 | paperVersion、question、candidate/confirmed、equations/roles/domain/assumptions/unknown、field→source；确认人/方法/差异，revision不可变 |
| ResearchTask / JobAttempt / Invocation / Operation；J1/A2 | scope、kind、canonical digest、state、parent、attempt、lease/fence、owner、usage/reservation、reply/toolCall关联、checkpoint；同幂等键异参拒绝 |
| RunRecord / ArtifactRef；S1/D1 | 既有ExperimentRun保持原ID/来源/parent/engine，状态/errors/误差；大数组带dtype/shape/hash。Run产生者是科学执行器，持久层仅保存。旧imported_runs不能伪升级来源 |
| ProgramRevision / ValidationReport；W1/A3 | sourceHash、ABI、model/goal revision、能力与权限、验证profile、见证hash/范围、公开策略、published状态；编译/沙箱/数学/可达报告分别记录 |
| PlayAttempt / ActionReceipt / Prediction / Assessment；W1/U2 | 冻结model/program/goal、单调revision/seq、authority位置、公开/私有命名空间、prediction前置cursor、Run引用、资源与玩法预算分别记账 |
| Checkpoint / WorkspaceEvent / CanvasCommandAck；U1/J1 | 输入/状态manifest hash、source/model/program/run/action cursor、UI布局revision；event序列按stream提交有序，UI命令持久待投影，ack含实际layoutRevision/客户端实例 |

SQL JSONB保存版本化DTO并不等于随意大JSON Store；关键归属/唯一键/版本写入约束落SQL。现有schema_migrations历史不改号，先确认已应用DDL与导出清单再增加迁移。新的Node repository不得靠Python函数内每次commit来模拟跨表事务：领域事务必须显式共享同一个pg client。科学Artifact先写临时文件并校验/原子封存，再在DB事务提交索引/回执/outbox；故障遗留blob可回收，不发布伪成功。

事件cursor不是随便取BIGSERIAL最大值：并发事务可能按不同顺序提交。首期workspace事件流在同一事务锁定stream计数行分配seq，再提交领域状态+outbox，保证已确认cursor前无未提交空洞；SSE按该序列补发，通知只唤醒查询，不能成为唯一事件来源。事务回滚不发布事件。游标保留期/裁剪与checkpoint绑定，过期客户端先取一致快照再按其cursor续订，不能从当前tail假装无遗漏。

## 6. DSH接入与进程所有权

API只持久ResearchTask并投递activation；worker租约成功后装载已确认上下文/工具目录/预算。官方`DeepSeekHarness`启动DSH runtime，`session().run(...,{onNotification})`或`resumeSession`读取历史；TS Plugin的execute(args, execContext)经受限端口请求同一Scientific Runtime。不要将完整原文/Run原始数组无限塞回模型。

DSH进程是推理与插件宿主，科学工作在拥有明确operation/attempt的执行单元；数据通过受检DTO/RPC返回。Runtime不直接写领域Run/世界表，领域仓库验证回执/计划/输入/来源。插件字段过滤在执行端再验，私有Q与解路径不进生成器/导演公共上下文。不得因为引入DSH就把shell、任意文件或网络工具默认开放。

持久保存assistant完整工具批次、原reply/toolCall ID、调用参数digest、逐项真实回执、模型/工具/程序版本与Session引用；DSH日志保存路径/Session id绑定task，不能临时目录每次换名重开。batch已记录未执行、部分完成、完成未回填三个窗口分别恢复。对未知provider是否已执行/计费，保留unknown，不盲重发prompt。

研究读取/生成/导演为同一助手的不同受限工具配置。新一轮activation恢复Session所需持久目录与唯一会话租约；不能同时启动两个writer操纵同Session。初期一个有界activation独占runtime；任务waiting_input保存检查点、关闭所属执行资源并释放槽位，回答验证revision后新activation接续。

固定审计DSH协议没有通用session/cancel，SDK超时不是执行终止；cancel_requested要传AbortSignal、终止拥有的科学worker/DSH进程并确认exit，再持久cancelled及用量。不要杀共享别的Session，也不要只关闭SSE。Node Worker/进程不是安全沙箱：可信科学工作可用Worker/子进程，生成World脚本仍走独立QuickJS/无宿主权限profile。[DSH官方SDK](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md)、[Node Worker](https://nodejs.org/api/worker_threads.html#workerterminate)。

## 7. 任务、事务与正式游戏提交

领域状态至少queued/running/waiting_input/retry_wait/cancel_requested/cancelled/succeeded/failed/interrupted；租约/fence区分新旧attempt。pg-boss投递内容只含taskId与预期输入版本，不复制私有状态；重复投递先查领域Operation结果。首选pg-boss公开Db适配`executeSql`包同一个pg client短事务：写task/operation/outbox并send，commit后共同可见；检查send可能返回null：若确属同operation且可查既有Job/回执则返回既有结果，否则回滚该accepted路径并返回冲突/重试，禁止留“领域queued但无Job”的孤儿；不直接写队列内部表。UI outbox保留用于事件发布，不能再无条件投第二遍任务。若锁定版本/现有接入不能共享事务才明确切换到outbox dispatcher入队，并验证发送后记账前崩溃的重复投递；两种策略不得同时生效。领域业务幂等始终必需，跨连接不假装原子提交。[pg事务要求](https://node-postgres.com/features/transactions)。

队列cancel/timeout不能自动证明handler停止；调度状态与所属进程退出各自记录。超时后旧attempt即使完成也受fence拒绝。队列成功只代表handler结束；领域operation有持久回执才报告completed，不把DSH idle、队列completed、HTTP202或图表已画等同于科学/产品成功。

正式Action：冻结program/model/goal、baseRevision和预算 → 持久操作预留 → 受控step产意图 → 合格科学Run → 候选state与独立Goal → DB短事务比较expectedRevision/fence后提交state+Assessment+玩法账+事件。科学计算在事务外，不长持锁等模型/Worker；并发冲突保留真实Run与费用，禁止应用过期结果。不允许一个未决Action旁路改同一attempt科学状态；相机/选择不进入科学写权。

Goal返回未达成是有效Assessment，可保存合法尝试；求值异常/证据错误拒绝候选state，释放可释放的玩法预留、结算真实资源。unknown只解释不计胜负。失败动作代价按冻结规则记独立幂等事件，不回滚真实费用。严格盲测由服务端重执行冻结step/Goal，不信客户端state或Run；离线只显示授权结果，不能改为本地Host续分。

新挑战有draft→compiled→validated→published状态，报告与program/model/goal hash绑定；验证未知则不发布正式挑战。发布只追加新revision，不碰现有关卡。Research Space读取snapshot/refs；Replay优先重放已封存Run/动作，重新计算是新的受预算操作，不能刷新页面自动重算/付费。

## 8. 体验反馈、提示与恢复

Study read-model包含sourceReadable、parseCoverage、modelStatus、worldStatus、runningOperations、pendingQuestions，不假定一个全局百分比。任务事件示例：source_available、parse_partial、model_needs_input、run_committed、world_published、action_assessed、hint_ready、checkpoint_saved。每条有eventId/streamSeq、entityRevision、operationId、引用与evidence；UI通过已提交事件投影，不靠模型句子猜状态。

Prediction可用无数值的趋势/区域/排序表达，必须绑定目标observable、拟执行Action规范hash、model/attempt revision、resultRevealedSeq；与后续Action hash不匹配时拒关联或重预测。浏览器已见preview时只能标“正式动作前预测，已见preview”，不能声称用户从未见过结果。用户提交必须绑定试次revision与揭晓游标；Action在同一事务验证其尚未被结果揭晓。Hint请求按attemptRevision+trigger+level去重，私有事实在broker过滤，返回observedRevision/runIds/sourceRefs/nonClaims；若状态已改变则显示过期建议或重新请求，不悄悄当当前结论。困难事件可记录重复合法失败而非臆测用户能力；默认不持续打断，用户可静音。

checkpoint在短REPEATABLE READ事务或共同stream锁保护的一致性切点读取来源/模型/程序/状态/已提交Run/未决Operation及snapshotCursor，不能各查询一遍后拼快照。保存时验证expectedRevision，锁顺序固定stream→attempt，冲突重试或409。恢复先原子替换该快照投影，再只应用seq大于snapshotCursor的事件，按eventId去重；不能在快照替换时丢掉其后的事件。

保存checkpoint只是可继续研究的最小制品，不保证所有正在运行Job完成。快照引用封存世界、未决operation、cursor和源版本；浏览器布局尚未ack可单独保存标pending。恢复先取快照与tail事件，再重连；异步旧回执保留历史但不覆写新revision。比较先核对模型/域/seed/分辨率/误差，不可比要解释，不能只输出两数字差。

## 9. 从现有桌面实现迁移：保留成果，不覆盖活跃工作

桌面源码已出现`server/db.py`、db_import/db_export和PG tables，不应因改TS重新造库。复用ID/blob布局、只读导入语义、SQL约束与已有测试oracle。先把现有schema/数据导出固定成迁移输入，Node `pg`适配同表并做只读对照；新增ParseArtifact/关联/任务等按消费者加表，不直接覆盖已存documents。

单一写权按领域切换：Node迁移器验证同库schema版本；受控维护边界停止旧消费者写入，排空/取消其任务，核对高水位及blob，原子切换该域writer配置。新消费者通过故障/恢复门后旧路径只读；回滚先导出切换后新增数据，不倒回旧快照。旧API路由做兼容转发，不双写。Python代码/CI/镜像最后在无消费者证明后退休，不先删除requirements。

不在API进程内跑长计算。首期API、worker共享同一应用部署与数据库，持久目录挂载制品/DSH Session，队列自有schema与业务migration分开，进程启动不任意删历史。关机先拒新任务→停止拉取→保存已确认checkpoint→有界停所属执行单元→关闭连接；活跃主会话先完成当前子项再合并本规范。

## 10. 五个最小技术验证（尚未运行）

1. Fastify+pg上传一个真实PDF：原文先可读；parse失败仍可开；同幂等键重传不造第二版本；写blob后/DB前崩溃不发布假完成。
2. DSH同版本SDK/runtime/Plugin+真实Qwen：两个Session隔离，工具输出驱动下一调用；参数基线与Run parent正确；三批次窗口恢复不重复副作用。provider缺凭据如实阻塞。
3. pg-boss+领域outbox：重复投递、事务入队回滚/send=null（采用备用outbox入队时才测dispatcher崩溃）、handler超时仍继续、取消进程迟退出，均无第二个可见副作用；旧fence不能提交，实际用量保留。
4. Kakeya单浏览器完整体验：预测→真实操作/Run→反馈/解释→查原文→保存→刷新继续；source/model/run/attempt同一链，不能拼接不同运行截图。SPD独立验生成程序，不拿Kakeya代签。
5. 新旧数据库迁移：旧ID、blob字节与hash、全部表/来源/Run引用导出恢复完整；Node新默认启动/上传/研究不要求Python或uv，旧不支持解析/数值能力诚实返回未覆盖。

本规范和[Node源码查证](backend-node-sources-20261106.md)共同交给主开发会话。没有新增主生产写者、安装依赖或执行上述验证；不因写了API表就声明后端完成。
