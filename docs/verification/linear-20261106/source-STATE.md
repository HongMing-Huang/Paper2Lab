# Paper2Lab 当前开发状态

更新：2026-11-06㉖（Asia/Shanghai）。B0、S1（父项）、A1（父项）、A0.1、A0.2、D1（父项）、P1（父项收口）done（各有独立复核终审）；J1.1 verifying（第三轮增量复核待做）；A0.3 blocked-凭据（Q-A03-1）。下一：J1.1终态签收→J1.CI→J1.2a→J1.2b。至今无新增产品Run（测试Run不计）。

- HEAD基线：37352d9e09f2e2c5f63017b3cfffc33471e708e0（2026-11-06核对一致）。
- 保留既有研究：AGENTS.md已有修改，docs/research/playable-mathematics-2026-11-02/未跟踪；不reset、不把研究失败材料删掉。
- 当前owner：ZCode主会话（chat）；当前开发子项：J1.1（verifying——实现+两轮复核处置完成，待第三轮增量复核）。下一子项按PLAN §4.1a：J1.CI测试隔离与CI必要服务→J1.2a新Node科学执行→J1.2b DSH适配。A0.3仍blocked-凭据（Q-A03-1）。
- 环境（B0.1实测）：node v25.4.0、pnpm 10.30.2、系统python3 3.14.2；**node_modules已存在（.pnpm 386包）且server/.venv已存在（Python 3.12.12，docling系依赖已装）**——推翻本文件旧版“未见node_modules/server/.venv”记载；.venv依赖清单核对归B0.3。供应商凭据未检查值，只记存在性待用。
- 产品检查点：C1（论文研究）、E1（生成游戏）、E2（持续使用）均未验收。旧M0–M9未执行，按PLAN映射迁移，无完成进度丢失。

- 上下文可见性（2026-11-06）：当前开发文档与完整研究已同时存在于0c04工作树及桌面主项目；它们仍是未提交文件，不会由Git历史自动传到其他worktree/远程Agent。执行前运行`node docs/development/verify_agent_context.mjs --root .`，再实际阅读。一次只选一个生产写者，不跨目录复用运行证据。
- 本副本目录：/Users/c14h14n3/Desktop/Paper2Lab。同步时已有src/skills/paperSpec.ts用户修改，未覆盖；B0必须按本目录现状重核代码地图与基线，0c04的静态读码/运行历史不等于本副本验收。


- 2026-11-06规范整理：AGENTS/LOOP/prompt已合并DSH/Node路线，J1.1仍按legacy范围；生产owner与任务完成状态未由本次整理改变。Linear认证UNAUTHORIZED，尚未创建任务，STATE保留临时进度权威。其接通与基线/资源隔离前其他窗口只读。
- 历史完整执行记录已移至[归档](docs/history/20261106-before-loop-unification/STATE-live-before-compaction.md)，按任务读，不默认加载。

## 任务状态（Linear导入前临时权威）

下表是工作包状态；依赖与完成合同只见PLAN。开发时在下一节登记当前子项，避免一次实现整个工作包。依赖未满足的todo无需逐项创建人工问题。

| ID | 状态 | 当前证据或下一动作 |
|---|---|---|
| B0 | done | B0.1/B0.2/B0.3均done且各有独立复核；Node 48文件312测试、Python 139测试、build全过，未发现旧失败 |
| S1 | done | 三子项done各有多轮独立复核；父项集成门（19断言+全量475+render-webgl+pytest28+once终态复验once-final-recheck.log）全过于终态代码/制品；Q-S13-1裁定移出项已入J1/N1/D1行（PLAN已修订，合并复核PASS） |
| A1 | done | 三子项done各有独立复核终审；父项集成门过（晚回执转J1已标注）。解锁A0.1/.2 |
| A0 | active | A0.1、A0.2 done（各有两轮复核终审）；A0.3 blocked-凭据（Q-A03-1已记录）；lane_b测试隔离债登记待修 |
| D1 | done | D1.1/.2/.3 全done（各有独立复核）；**父项集成门**：真实上传消费者PG唯一写权威（无双写探针实证）+同文件去重+legacy只读导入可重复+导出清库恢复演练计数相等——PLAN D1行完成证据全部满足。解锁P1/J1 |
| P1 | done | 三子项done各有独立复核；父项完成证据全满足（去重保留来源/版本并存/旧anchor不破坏/失败可读原PDF/VLM页级精度） |
| J1 | active | J1.1 verifying（真实解析任务经PG账本+Redis/RQ由独立worker进程消费；15快测三连绿+真docling 57s；全量快集213过；两轮复核均"有条件通过"、必修已处置，第三轮增量复核待做）；J1.2/J1.3 todo |
| L1 | todo | 真实搜索→全文→锚点→引用链未在新产品路径验收 |
| N1 | todo | paperSpec/Cortex与已有执行器可复用；通用条件/修订/能力合同未完成 |
| A2 | todo | 历史有真实供应商回合；新研究工具循环与恢复未验，当前配置未知 |
| U1 | todo | 现有论文桌面可复用；新领域引用、问题与事件ack恢复未验 |
| C1 | todo | 依PLAN做完整论文研究验收；不得从旧测试计数签收 |
| W1 | todo | 程序ABI/Host权限与生成Goal隔离未实施 |
| W2 | todo | QuickJS发布制品/Worker/CSP及资源退出未验 |
| W3 | todo | SPD注册能力/纯Host/Solver待实现；独立研究几何探针不是产品Skill |
| A3 | todo | 真实Qwen双程序生成/诊断修复/导演下一关未验 |
| U2 | todo | 动态世界真实操作/单状态/资源回收未验 |
| E1 | todo | 完整生成游戏循环未验收 |
| X1 | todo | 函数/ODE游戏协议复用未验；不等于已有图表能力 |
| O1 | todo | 新产品发布前可靠性/构建/恢复检查未执行 |
| E2 | todo | 全产品支持范围与交付验收未完成 |

## 当前子项与恢复点

### J1.1 开工卡与执行记录（2026-11-06㉕，owner：ZCode主会话；状态：verifying——首轮独立复核"有条件通过"（十项探针全PASS：并发8进程claim仅1赢家/finish不覆盖/结算后cancel False/5连reconcile幂等/超时连杀两hang子进程worker存活/Redis不可达→queued+queueError可恢复/回退路径与HEAD逐字节diff 0/搬移逐行核对/安全面全PASS/诚实登记10项逐条属实）；唯一必修=STATE计数更正（原误写"12快测三连跑"——归档green-run1..3实为**10测**，两加固测在其后），已更正。复核should-fix①单事务已修：parse_store.persist_parse_result增commit=False，worker的文档+parse artifact+task settle在**同一事务**提交（oracle探针实证旧序列留1孤儿文档、新路径0）；②RQ-started重建表述按复核更正（见登记②）；nit：main.py未用anchor_precision_for导入已删。**修复改动了已审文件→按LOOP §2 独立复核须增量复核后才能签done**。**第二轮增量复核"有条件通过"**：代码A–E/G全PASS（隔离库探针：单事务六失败分支B1–B6均无"文档可见而task停running"或"succeeded缺文档"、lost回滚、默认行为对其他调用方不变、新测在首轮代码上必红）；三必修均为STATE文档——M1"14快测三连跑"仅归档r1（r2/r3为当时真实输出但未归档，已补归档green-atomicity-3runs-r2/r3）、M2登记②与RQ实际不符（已按实证重写）、M3任务表计数陈旧（已更新）；另**探针复现预存缺陷**（reconcile在RQ执行条目60s间隙删除陈旧job抛错→未守卫致worker启动崩溃、整轮中止）→立案failureId J1.1-F1，修复尝试1=逐任务守卫，attempt-3红→绿；S1 finish_task(commit=False)的隐式rollback改为调用方显式回滚（文档化事务归属）；S3行为变更已登记⑮；nit标签"result commit failed"。**第三轮增量复核（仅attempt-3 delta）待做**）

- 开工卡：行为=一个**真实解析任务**（docling精读）落task/attempt/outbox，由**实际独立worker进程消费**，queued状态可在队列丢消息/重启后从PG重建（PLAN J1.1步："实际worker消费，queued状态可重启重建；先不上全部队列"；J1行"不是仅保存一条queued记录"）；输入=P1+S1+A1 done、PLAN J1行/J1.1步、AGENTS宪法（科学状态在Runtime，解析结果写D1.3唯一写权威）；范围=迁移14步+jobs.py账本状态机+parse_worker.py（RQ SimpleWorker进程）+ingest_runner.py（warm可杀子进程，从main.py**原样移出**共享）+parse_store.py（文档+parse artifact持久化，从main.py persist_doc抽出共享）+main.py队列路径/读账本/supersede/启动reconcile+requirements(rq)+测试；负例=重复投递、取消、超时真终止、队列丢消息、无Redis回退、无队列worker拒启。
- 环境门：Redis 8.x（brew，localhost:6379，`redis-cli ping`→PONG）+rq 3.0.0入venv（requirements增`rq>=2.0,<4`）。测试用**专用逻辑库redis db 15**（flushdb不碰宿主其他数据）。
- 中途方向修正（自查，非复核）：attempt-1初版只在API进程内写账本+往RQ推`noop`占位job，worker仍是进程内run()——**不满足PLAN门"实际worker消费"**（STATE不可签"仅保存queued记录"），推翻重做为attempt-2。attempt-1另一发现：rq 3.x队列存储键为`rq:queue:<name>`，裸`llen(name)`恒0（探针证实），断言改用`Queue.count`。
- 红（attempt-2）：`docs/verification/J1.1/attempt-2/red.log`——10测全红（server.parse_worker不存在/WORKER_FUNC缺/API仍进程内跑等）；追加2测（supersede读陈旧内存状态、queueDepth计入无关任务）先红后绿（red3见下）。
- 实现：
  - **迁移14步**：research_tasks增stage/result JSONB/started_at（回滚注记双向）。
  - **jobs.py账本（PG权威，RQ只投递）**：create_task（task+queued attempt+task.queued事件同事务）；enqueue_task（确定性job id `p2l-parse-{task_id}`，**幂等**：live且确在队列中→不重推；陈旧记录（finished/failed或hash在而队列条目丢）→删后重推）；reconcile_queued（账本queued→保证有live RQ job，发task.requeued；**逐任务守卫**：单条坏RQ记录rollback本任务部分工作+记日志并跳过，不中止整轮——F1）；**claim_task原子条件UPDATE queued→running**（输家=重复投递/已取消/已结算→记task.delivery_skipped不重跑）；finish_task原子running→succeeded|failed+结构化result（不覆盖已结算；commit=False时事务归调用方——True提交、False由调用方回滚）；cancel_queued原子queued→cancelled；queued_position（UI"前面还有N-1个"）。
  - **parse_worker.py**：`python -m server.parse_worker [--burst]`；启动先reconcile再消费；SimpleWorker（job在本进程跑→warm docling子进程跨任务存活，模型只加载一次）；每任务：claim→从内容寻址blob取上传字节→ingest_runner.WarmIngestWorker转换（与API进程内路径**同一实现**，单持久事件循环持有子进程管道）→parse_store写文档+append-only parse artifact→finish；超时由我方kill子进程（RQ death penalty=ingest超时+120s仅兜底）；缺DB/Redis配置exit 2响亮拒启。
  - **main.py**：DB+Redis均配置且mode=docling且上传已入库→**API只写task+入队后立即返回queued+taskId**（不再进程内解析）；status从账本读（succeeded→从D1.3文档表取doc；failed→timeout/error按result.kind）；queueDepth对队列任务取账本位置；**supersede改由账本裁决**（queued→原子取消，worker认领失败不解析；running→用户侧superseded、worker完成（取消running归J1.3）；已结算→保留真值——修复了"未轮询的已完成任务被误标superseded"）；_restore_jobs：队列任务**不再被标interrupted**（worker独立于API）；另修存量缺陷：进程内**queued**任务重启后原先永远停在queued无人执行（PLAN登记缺陷"queued可能留下但无人执行"），现与pending/running同标interrupted；lifespan启动reconcile（有界15s、失败可见）；账本行一旦写入，**入队失败不回退进程内**（否则后续投递会二次解析）——留queued待reconcile；ledger写入后立即persist job→task关联。
  - 无DB/Redis或mode=vlm→原进程内路径**行为不变**（VLM仍进程内：先迁一个任务种类，登记）。
- 绿：test_jobs_j11 覆盖（API只入队+**独立进程**worker消费（attempt detail记worker pid≠测试pid）→done+文档可读+parse_artifact 1行+队列清空+事件序列queued→running→succeeded / crash→failed+result.kind=error / **超时真终止**（2s超时、300s hang在<60s内被切、result.killedPid经os.kill(pid,0)证实进程已不存在）/ 重复投递只跑一次（running/succeeded各1+delivery_skipped 1）/ Redis flushdb后worker启动从PG重建并完成（task.requeued）/ API两次重启reconcile幂等（队列恒1）后worker完成且只跑一次 / API重启后队列任务存活不被interrupted / 同tab supersede：queued任务ledger cancelled且从未running / 已完成未轮询任务不被误标superseded / queueDepth按账本位置1、2 / 无Redis→进程内路径不变且零账本行 / 无队列worker exit 2 / 进程内queued重启标interrupted / 孤儿文档事务）。**计数据实**：首批10测三连跑全绿（6.4–6.5s，green-run1..3）+2加固测（red3-hardening先红后绿）+1中断测（green-final 13过）——首轮"12快测三连跑"为误写，复核指出后更正；复核修复轮+1孤儿文档事务测（oracle先证旧序列留1孤儿document，修复后0）共**14快测**三连跑（green-atomicity-3runs-r1..r3：7.85/6.69/6.73s——首次签收时只归档了r1，第二轮复核指出后补归档r2/r3，日志为当时真实输出）；attempt-3（F1修复）+1 reconcile逐任务守卫测共**15快测**三连跑（attempt-3/green-run1..3：10.45/7.95/7.42s，三份全归档）。另**真实论文解析**`real_docling`测（ode-lotka-volterra.pdf真docling经队列worker：首跑55.1s绿于修复前（real-run2）；单事务修复后重跑59.1s绿（real-run3-after-fix-green）；engine=docling、≥2公式、stage=parsing、attempts queued→running→succeeded、parse_artifact parser=docling/precision=region）。
- 真实运行发现（非oracle）：真实测首跑失败于**SOCKS代理在docling Hub检查时General SOCKS server failure**——worker如实记failed+真实错误（`real-run1-proxy-failure.log`）；改用文档化部署设定`PAPER2LAB_DOCLING_OFFLINE=1`（ci-daily已预热模型缓存）后绿（`real-run2-offline-green.log`）。
- 失败记录：**failureId J1.1-F1**（第二轮复核立案）——现象：RQ 3.0.0执行条目比执行记录多存60s，间隙内`Job.fetch(...).delete()`抛`ValueError: Execution … not found in Redis`（复核者db14探针复现：启动#2的reconcile抛错、63s后启动#3返回[1]）；假设：reconcile无逐任务守卫→异常上抛→worker启动崩溃、同轮其余任务全丢；改变（尝试1）：reconcile_queued逐任务try/except（rollback本任务部分工作+stderr日志+任务留queued）；结果：注入同型异常的红测（attempt-3/red.log：ValueError上抛、好任务未重推）→绿（坏记录跳过、好任务重推、坏任务仍queued）。约60s的真实RQ时序窗未在套件内复现（套件以注入固定异常替代等待）。
- 回归：全量快集（`-k "not real_docling" -m "not real_pdf_trace"`）首轮**208过4 deselected**（=198基线+10新测）；加固（ledger裁决supersede/队列位置/入队off-loop）后复跑**210过4 deselected**（`pytest-full-quick.log`）；再加"进程内queued重启标interrupted"测后J1.1快测**13过**（`green-final.log`）；单事务修复后全量快集**212过4 deselected**（`pytest-full-quick-after-fix.log`）。test_parse_artifacts_p12改从parse_store导入anchor_precision_for（函数移动，断言不变）。前端零改动（upload.ts已处理queued/superseded/error/timeout；POST响应status由running→queued对客户端透明——客户端只读jobId后轮询）。
- 诚实登记（J1.1范围外，移交）：①worker**中途**死亡（已claim）→task停running直到**J1.2**租约/心跳/fencing；②RQ已出队未claim窗口崩溃→RQ job残留started，启动reconcile跳过它。**按第二轮复核实证（RQ 3.0.0源码+db14探针）重写**：burst与长驻worker都在首轮循环跑RQ maintenance，会把过期的started job移为failed（SimpleWorker运行中job的TTL=job.timeout+60=ingest超时+180s，非此前所写+120s）；之后再一次启动reconcile即重建——崩溃后经过TTL的两次启动可恢复，无需长驻worker（原"须长驻、burst一直跳过"表述错误）。另RQ执行条目比执行记录多存60s，此间隙内删除陈旧job抛"Execution … not found"——曾令未守卫的reconcile使worker启动崩溃、整轮中止（**F1，已修**：逐任务守卫，该任务留queued待后续reconcile）。租约/心跳从根本收口仍归**J1.2**、周期reconcile归J1.3；③取消**running**队列任务→**J1.3**（现为用户侧superseded+worker跑完）；④reconcile仅在worker/API**启动**时（周期reconcile归J1.3）；⑤VLM快读仍进程内（任务种类逐个迁移）；⑥job JSON（API侧）与账本两处真相——账本为权威、job JSON为UI缓存；job→task关联在create_task后立即persist，剩余微秒级窗口（commit与persist之间崩溃→job显示interrupted而任务仍会被解析）随J1.2/D级job入库收口；⑦**CI（ci.yml/ci-daily）无PG/Redis服务→本组测试skip**（与D1/P1同况），需加services；⑧db.migrate仍无部署入口（D1现状，worker/API均不自动迁移以免并发迁移竞态）；⑨执行预算（Q-S13-1移入J1）未在J1.1实现——随J1.2/J1.3接科学执行时落；⑩`/api/ingest`同步阻塞DB调用（D1.1仓储往返）为存量，新账本调用已改to_thread。**复核附加登记**：⑪状态轮询每次新建2个PG连接（无池）——J1.2落租约时池化；⑫enqueue_task删旧推新与RQ出队瞬间（pop后status=started前）有理论竞态——因claim原子性后果良性（多一次delivery_skipped）；⑬同tab在task_id persist前的并发双击可逃逸supersede（毫秒窗，与旧路径同类）——J1.3；⑭部署约束：API与worker的`PAPER2LAB_INGEST_TIMEOUT`须一致（job_timeout_s在入队进程计算，API长于worker时RQ兜底可能先于我方kill）；burst worker退出后新任务等下次启动——生产用长驻模式。**第二轮复核附加登记**：⑮**行为变更**（单事务的连带后果）：进程内API路径若parse artifact写失败，文档随之回滚（旧双提交下文档仍可读）——job仍显示done并带repo.error（D1.3既定"失败可见、不回落JSON"语义），但`/api/document/{docId}`返回404、重启后该job无文档；与全有或全无一致，无既有测试依赖旧行为（D1.3失败测为整库宕机）；⑯worker的RQ返回值在"commit已达服务端而客户端报错"时为failed而账本为succeeded（无害，账本为权威）；lost路径（结算被他方抢先）不写事件/attempt行——J1.1不可达，J1.2 fencing补记；⑰取消路径目前只有同tab supersede；若他路径取消队列任务，job会显示`cancelled`，前端轮询不视为终态——随J1.3取消语义收口。
- 证据：docs/verification/J1.1/attempt-1/（red/green——初版，已被推翻）、attempt-2/（red、red3-hardening、green-run1..3、green-final、green-final14、green-atomicity-3runs-r1..r3、orphan-oracle-pre-fix、pytest-full-quick、pytest-full-quick-after-fix、real-run1-proxy-failure、real-run2-offline-green、real-run3-after-fix-green）、attempt-3/（red、green-run1..3、pytest-full-quick=**213过4 deselected**、real-docling-green=57.4s）。首轮复核冻结sha：jobs.py=0332505a、parse_worker.py=1bd27a76、ingest_runner.py=2edbbe23、parse_store.py=ee604b16、main.py=d1e6eec4、db.py=ac116f3d、test_jobs_j11.py=70b16fe4、requirements.txt=8cb466d8、test_parse_artifacts_p12.py=cec2ec83。第二轮复核冻结sha：db.py=971e71c4、parse_store.py=d3404d4e、parse_worker.py=0da27adc、jobs.py=500bf767、main.py=620bcd26、test_jobs_j11.py=ad94a6f7（ingest_runner/requirements/test_parse_artifacts_p12未变）。**attempt-3后sha**：jobs.py=a20db3ae、parse_worker.py=9c181419、test_jobs_j11.py=37a9062d（db.py/parse_store.py/main.py/ingest_runner/requirements/test_parse_artifacts_p12与第二轮相同）。
- 下一动作：第三轮增量复核（仅attempt-3 delta：jobs.py reconcile逐任务守卫+finish_task事务归属、parse_worker显式回滚+标签、2测、STATE本节M1–M3/⑮–⑰/F1文字）→done→J1.CI→J1.2a→J1.2b。

## 人工问题与阻塞队列

当前A0.3凭据问题仍待处理；新增Linear认证问题只影响任务导入/多窗口写分派，不阻塞当前单写者的无依赖实现。不输出秘密，不重复问同一问题。

| questionId / task.subtask | 类别与已查原因/证据 | 精确问题、选项/推荐、默认是否允许 | 受阻范围 / 可继续项 | 回答生效前提 / 恢复触发 | 时间 / 状态 / 处理结果 |
|---|---|---|---|---|---|
| Q-S13-1 / S1.3 | 完成门变更（LOOP §5）。独立复核三轮确认代码必修全过；5项合同归属按推荐裁定 | 裁定来源：会话续行指令逐项采纳推荐（①J1 ②N1+D1 ③D1 ④接受为S1语义+N1收紧 ⑤D1）；**诚实登记：用户未亲自逐项作答，此为运行时续行指令的裁定**——若用户后续明确反对，按LOOP标superseded并回滚PLAN修订 | 曾阻S1.3签收与S1收口；现均解除 | 回答时HEAD=37352d9+本会话修复（制品28d454c1/a7ff191c） | 2026-11-06⑪ / applied / PLAN已修订（S1行+J1/N1/D1行），S1.3据此收口 |
| Q-A03-1 / A0.3 | 凭据（LOOP §3缺凭据行）。B0.3实测：env无PAPER2LAB_AGENT_*/DASHSCOPE_*、仓库无.env | A0.3真实验收需OpenAI兼容供应商凭据（如discovery-api qwen）。请在宿主环境（shell env或部署secrets）配置 PAPER2LAB_AGENT_PROVIDER/…_BASE_URL/…_MODEL/…_API_KEY（历史用discovery-api.intern-ai.org.cn/v1+qwen3.8-27b）；不粘贴明文密钥到对话/仓库。默认：无——A0.3真实验收保持blocked，fixture不签收 | 凭据阻A0.3真实验收；另须已集成J1.2b的DSH适配才ready。可继续无依赖必要任务 | 配置后HEAD须仍≥37352d9+本轮修复 | 2026-11-06⑱ / open / 待配置 |

问题状态：open → answered → applied，或superseded。blocked任务另记录environment/dependency/defect/review原因，没有人工动作就不要伪造questionId。回答收到后先校验revision与权限，再解除阻塞；下游仍要验收。


- Q-LINEAR-1：Linear工具读取项目/团队均返回UNAUTHORIZED/requires reauthentication；已异步请求重新连接。没有issue被创建。恢复触发：用户连接后实际读取成功，再查重、写入和回读；不能假称已同步。

## 近期记录

- 2026-11-06㉔（P1.3+P1收口）：迁移10（papers.identifier+部分唯一索引）+store_paper_upload identifier分支（同identifier异bytes=同paper两版本并存）+ingest identifier表单字段。6测（去重/版本并存/无identifier不变/crash重试保旧anchor/缺全文诚实原PDF可读）+**真实PDF完整trace**（真docling 54.8s：真版本+region+items+字节全等——real_pdf_trace marker）。复核首轮抓必修#2（跨路径version_id冲突丢上传+identifier丢弃）→修复（Paper作用域version_id+NULL回填）+探针实证→终审通过。**P1父项收口done**。残留随L1（第三identifier吸收）。未commit/push。
- 2026-11-06㉓（P1.2 done）：迁移9步parse_artifacts（append-only）+_anchor_precision_for（docling→region/vlm→page/未知拒猜）+persist_doc追加parse artifact行+GET /papers/{id}/parses（列表）与 /parses/{id}（完整JSON，旧anchor可打开）。7测（重解析两行旧行可开、旧page新region无升级）+全量快集193过（含4旧fixture TRUNCATE必更维护——FK阻断16e+2f先复现后修）。复核七项PASS（append-only/精度/端点探针实证）。未commit/push。
- 2026-11-06㉒（P1.1 done）：GET /api/papers（版本列表+upload来源嵌套；无库诚实空、故障502）+GET /api/papers/{id}/pdf（内容寻址blob服务原PDF——解析运行中/失败/完成均可读；404/410）；db.py两helper（list_papers三表JOIN装配/paper_artifact_sha最新版本）。7测（含hang窗口内pdf 200原字节、crash失败后pdf 200）+全量快集186过。复核六项PASS+**热修D1.3遗留import序缺陷**（_restore_jobs调用先于_get_doc定义→data目录有docId job时import崩——真实data目录探针复现验证修复）。未commit/push。
- 2026-11-06㉑（D1.3+D1收口）：迁移8步documents表+persist_doc DB模式只写PG（无双写、失败repo_error不回落JSON）+_get_doc PG先legacy只读回退+db_export.py导出/恢复演练（6表FK父序、计数相等断言）。5测+全量快集179过。复核"通过"（导出恢复自跑实证）；三建议当场处置（重启恢复改_get_doc修docId丢失/测试4补正向断言/STATE补记export不含imported_*）。**D1父项收口done**：PLAN D1行完成证据全满足，P1/J1解锁。未commit/push。
- 2026-11-06⑳（D1.2 done）：migrate 6/7步（imported_docs/imported_runs落地表）+db_import.py（doc快照与runlog只读导入：原ID保留、provenance=legacy-*、sha256逐源可验、同id同hash幂等skip/异hash conflict不覆写/坏行只丢自己、legacy数字JSONB逐字零重算零新Run）。8测+全量快集174过；**真实快照导入**：11 docs/777行runlog→421导入+356log内同id同内容重复幂等跳过，清表重跑同数、暖跑零新行。复核六项PASS（自跑真实导入逐数吻合+hash独立复算）；建议的conflict正向hash断言当场补。未commit/push。

## 接续约束

本次只整理规范，不自行签J1.1 done；当前owner冻结终态代码、复跑受影响门并增量review后再收口。J1.CI优先解决测试隔离和CI必需服务；J1.2a/b按新Node/DSH合同实施，旧成果保留原范围。新基线未完整提交且Linear未导入前不启动第二生产写者。历史hash/review只对当时文件有效，不移用签新变更。
