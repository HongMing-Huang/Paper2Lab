# Paper2Lab 当前开发状态

更新：2026-11-06㉖（Asia/Shanghai）。B0、S1（父项）、A1（父项）、A0.1、A0.2、D1（父项）、P1（父项收口）done（各有独立复核终审）；J1.1 verifying（第三轮增量复核待做）；A0.3 blocked-凭据（Q-A03-1）。下一：J1.1签收→J1.2。至今无新增产品Run（测试Run不计）。

- HEAD基线：37352d9e09f2e2c5f63017b3cfffc33471e708e0（2026-11-06核对一致）。
- 保留既有研究：AGENTS.md已有修改，docs/research/playable-mathematics-2026-11-02/未跟踪；不reset、不把研究失败材料删掉。
- 当前owner：ZCode主会话（chat）；当前开发子项：J1.1（verifying——实现+两轮复核处置完成，待第三轮增量复核）。下一子项：J1.2（只读调研已完成，拟拆J1.2a /api/engine/execute经计算worker+Run/回执单事务+租约fencing、J1.2b Agent服务端执行+取消）。A0.3仍blocked-凭据（Q-A03-1）。
- 环境（B0.1实测）：node v25.4.0、pnpm 10.30.2、系统python3 3.14.2；**node_modules已存在（.pnpm 386包）且server/.venv已存在（Python 3.12.12，docling系依赖已装）**——推翻本文件旧版“未见node_modules/server/.venv”记载；.venv依赖清单核对归B0.3。供应商凭据未检查值，只记存在性待用。
- 产品检查点：C1（论文研究）、E1（生成游戏）、E2（持续使用）均未验收。旧M0–M9未执行，按PLAN映射迁移，无完成进度丢失。
- 本次文档增量：已完成完整原目录搬迁、目标/任务增量修订与独立复核，见[复审报告](docs/research/playable-mathematics-2026-11-02/implementation-review-20261105.md)及[审查身份](docs/research/playable-mathematics-2026-11-02/evidence/implementation-review-20261105.json)。前三个只读分支提出10项合并问题，最终reviewer /root/final_design_review复核修订通过；本轮/root/audit_full_migration独立验整树迁移，/root/audit_delivery_execution补原文忠实性负例并复核任务门通过；不等于产品或数学运行验收，以下工作包仍未执行。

- 上下文可见性（2026-11-06）：当前开发文档与完整研究已同时存在于0c04工作树及桌面主项目；它们仍是未提交文件，不会由Git历史自动传到其他worktree/远程Agent。执行前运行`python3 docs/development/verify_agent_context.py --root .`，再实际阅读。一次只选一个生产写者，不跨目录复用运行证据。
- 本副本目录：/Users/c14h14n3/Desktop/Paper2Lab。同步时已有src/skills/paperSpec.ts用户修改，未覆盖；B0必须按本目录现状重核代码地图与基线，0c04的静态读码/运行历史不等于本副本验收。

## 任务状态（唯一来源）

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

### J1.1 开工卡与执行记录（2026-11-06㉕，owner：ZCode主会话；状态：verifying——首轮独立复核"有条件通过"（十项探针全PASS：并发8进程claim仅1赢家/finish不覆盖/结算后cancel False/5连reconcile幂等/超时连杀两hang子进程worker存活/Redis不可达→queued+queueError可恢复/回退路径与HEAD逐字节diff 0/搬移逐行核对/安全面全PASS/诚实登记10项逐条属实）；唯一必修=STATE计数更正（原误写"12快测三连跑"——归档green-run1..3实为**10测**，两加固测在其后），已更正。复核should-fix①单事务已修：parse_store.persist_parse_result增commit=False，worker的文档+parse artifact+task settle在**同一事务**提交（oracle探针实证旧序列留1孤儿文档、新路径0）；②RQ-started重建表述按复核更正（见登记②）；nit：main.py未用anchor_precision_for导入已删。**修复改动了已审文件→按LOOP §2.5须增量复核后才能签done**。**第二轮增量复核"有条件通过"**：代码A–E/G全PASS（隔离库探针：单事务六失败分支B1–B6均无"文档可见而task停running"或"succeeded缺文档"、lost回滚、默认行为对其他调用方不变、新测在首轮代码上必红）；三必修均为STATE文档——M1"14快测三连跑"仅归档r1（r2/r3为当时真实输出但未归档，已补归档green-atomicity-3runs-r2/r3）、M2登记②与RQ实际不符（已按实证重写）、M3任务表计数陈旧（已更新）；另**探针复现预存缺陷**（reconcile在RQ执行条目60s间隙删除陈旧job抛错→未守卫致worker启动崩溃、整轮中止）→立案failureId J1.1-F1，修复尝试1=逐任务守卫，attempt-3红→绿；S1 finish_task(commit=False)的隐式rollback改为调用方显式回滚（文档化事务归属）；S3行为变更已登记⑮；nit标签"result commit failed"。**第三轮增量复核（仅attempt-3 delta）待做**）

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
- 下一动作：第三轮增量复核（仅attempt-3 delta：jobs.py reconcile逐任务守卫+finish_task事务归属、parse_worker显式回滚+标签、2测、STATE本节M1–M3/⑮–⑰/F1文字）→done→J1.2。

### P1.3 开工卡与执行记录（2026-11-06㉔，owner：ZCode主会话；状态：done——复核两轮：首轮"有条件通过"（必修#2跨路径version_id冲突：DOI传v1+v2后裸传v2→paper_versions_pkey UniqueViolation整事务回滚丢上传+identifier静默丢弃）→修复（version_id改按hash(paper_id:sha)派生=Paper作用域；identifier仅对NULL回填）→cross-path-probe.log实证两场景消除→**终审通过**（复核者独立复跑快集19过+真docling trace 54s+全量198自洽）。STATE更正按复核意见：本项快集为5快+1排除（real_pdf_trace）；跨路径崩溃后果与修复补登如上。残留登记（随L1）：异identifier同sha paper再传第三identifier被吸收不回填（无崩溃、有upload_events）。db.py终值a9302726。**P1.3 done——P1三子项齐，父项收口见下**

- 开工卡：行为=重复PDF去重/同DOI不同版本并存/解析失败重试不破坏旧anchor/缺全文校验+一份真实PDF完整trace（不以fixture签收新解析）；输入=P1.2 done+PLAN P1行P1.3步；范围=迁移10步（papers.identifier+部分唯一索引）+store_paper_upload identifier分支+ingest identifier表单字段+测试+pytest.ini marker。
- 红：`red.log`（identifier版本/失败重试/缺全文三测失败——identifier路径不存在）。
- 实现：①迁移10步：papers加identifier TEXT+`(workspace_id, identifier) WHERE NOT NULL`部分唯一索引（回滚注记双向）；②store_paper_upload——identifier给出时**按(ws,identifier)找paper**（找到→新bytes成为同paper新version并存；没找到→建带identifier的新paper）；无identifier→原sha键控行为不变；③/api/ingest增可选`identifier`表单字段透传。
- 绿：test_papers_p13 6测快集（同bytes两上传一paper一version两uploads/同identifier异bytes一paper两version两sha共存/无identifier仍sha键控两paper/**crash的v2解析留零artifact且v1 parse可开→重试加为第二parse旧行存活**/只有失败解析的paper零parses零docId但原PDF 200）+**真实PDF完整trace**（`real_pdf_trace` marker、真实docling 54.8s：sample-harmonic.pdf→parse_artifact带真doclingVersion与region精度→items非空→原PDF字节全等——不以fixture签收的合同要求满足）；全量快集**198过3 deselected**（+6，pytest.ini注册marker）。
- 测试途中自修（非oracle）：retry测试先在阶段间重调_env清库（测出真隔离缺陷后改monkeypatch切convert mode不清库——这是测出"重跑fixture会清库"的真问题）；缺全文断言"docId not in done"在error job携带docId=None时恒过（改not done.get）。
- 诚实登记：identifier来自表单（PDF内DOI提取是L1标识解析的范围——登记）；identifier的paper其sha256列存首见版本的sha（标识键控后sha列退化为元数据——P1.2的UNIQUE(ws,sha)仍约束无identifier路径）；重试语义=同bytes新job新parse artifact（planId级去重归J1操作账本）。
- 证据：docs/verification/P1.3/attempt-1/（red/green/real-pdf-trace/pytest-full-quick）。sha256：db.py=59a98e25、main.py=002f57a2、test=daa58135、pytest.ini=013df515。
- 下一动作：~~独立复核→done→P1父项收口~~ 已完成。**P1父项收口**：三子项done（P1.1版本列表+原PDF/P1.2解析产物精度+append-only/P1.3 identifier版本并存+失败重试+真实PDF trace）；PLAN P1行完成证据逐项满足（同文件去重保留来源✓——跨路径探针实证/同论文新版本并存✓——identifier两sha版本/重新解析不破坏旧anchor✓——crash重试测/解析失败PDF仍能读✓——缺全文诚实/VLM页级精度明确✓——P1.2推导+真实docling region实证）。**P1 done。**

### P1.2 开工卡与执行记录（2026-11-06㉓，owner：ZCode主会话；状态：done——复核"通过"七项PASS（append-only探针实证旧行逐字段未变/精度三分支自跑/端点跨paper 404探针/挂接分支码读+真实路径doclingVersion确认/迁移9步重建探针/fixture补丁判定"必更维护"断言未缩/声称吻合）。复核微瑕已补记：quick首轮除16 errors外另有**2 FAILED同因**（FK阻断TRUNCATE，quick2全转绿）。VLM真实回合未测（无凭据）与unknown占位登记如实；vlmModel回退分支无生产者（死码无害，登记）。**P1.2 done。**

- 开工卡：行为=Docling/VLM产物带parser版本与锚点精度（region|page），重解析产生新artifact，旧anchor可打开、不将页级来源升级成字符级；输入=P1.1 done+PLAN P1行P1.2步；范围=迁移9步+db.py三helper+main.py精度推导与两GET端点+persist_doc挂parse_artifact+测试（旧fixture TRUNCATE列表补parse_artifacts——FK约束阻断父表TRUNCATE的必更维护）；负例=未知引擎拒猜精度、旧precision不升级、未知parse_id 404。
- 红：`red.log`（collection error——_anchor_precision_for与端点不存在）。
- 实现：①迁移9步parse_artifacts（id BIGSERIAL PK、paper/version FK、doc_id、parser、parser_version、anchor_precision、parse_json JSONB、created_at——**append-only，重解析加行不覆写**）；②`_anchor_precision_for(engine, version)`——docling→region、vlm→page、**未知引擎ValueError拒猜**（错精度会静默破坏anchor可打开性）；③persist_doc在D1.3写权威内**追加**parse_artifact行（parser=self.mode、version=doclingVersion/vlmModel、precision写入时盖章）；④GET /api/papers/{id}/parses（列表不带body，最新在前）与 /parses/{parse_id}（完整parse JSON——旧anchor可打开）。
- 绿：test_parse_artifacts_p12 7测（docling→region+parser身份/vlm→page/未知引擎拒/首解析带身份精度/重解析两行旧行可开含docId/**旧page精度行重解析后仍page新行region——无升级**/未知404）；全量快集**193过2 deselected**（+7；含4个旧fixture文件的TRUNCATE维护补丁——16 errors先复现FK阻断后修）。
- 诚实登记：VLM路径的parse_artifact落库未在真实VLM回合测（无凭据——precision推导有单测，落库路径与docling同代码）；test convert "ok"模式的result无doclingVersion字段→parser_version="unknown"占位（真实Docling解析带版本——fixture限制，真实路径有real_docling套件覆盖）。
- 证据：docs/verification/P1.2/attempt-1/（red/green/pytest-full-quick2）。sha256：db.py=a12355a9、main.py=505ffdb8、test=bfd08a73（fixture补丁：db_d1=6070e55c、consumer=1d040dd0、d13=632830d1、p11=840ff405）。
- 下一动作：独立复核→done→P1.3（重复PDF/同DOI不同版本/失败重试/缺全文校验+一份真实PDF完整trace）。

### P1.1 开工卡与执行记录（2026-11-06㉒，owner：ZCode主会话；状态：done——复核"通过"六项PASS（端点语义含hang自跑/SQL装配探针/pdf路径安全与410/测试有效性/范围纪律/声称吻合）。**复核范围外发现的真实缺陷已当场热修**：D1.3引入的模块级`_restore_jobs()`调用位于`_get_doc`定义之前——data目录存有带docId的job时import即NameError（复核者首跑复现崩溃；主Agent绿测因临时空数据目录漏过）。修：调用移至定义后（main.py终值06580225），**用真实data目录探针复现-验证**（import ok+job恢复+doc服务）；21测回归过。该项缺陷源自D1.3复核建议①的落位错误，P1.1修复并记录）

- 开工卡：行为=上传与打开复用现有入口，建立版本列表/来源；解析未完成或失败时仍能读原PDF；输入=D1 done+PLAN P1行P1.1步；范围=db.py两helper（list_papers/paper_artifact_sha）+main.py两GET端点+测试；负例=无库诚实空列表（不造JSON假库）、未知paper 404、blob缺失410。
- 红：`red.log`（7测失败——/api/papers与pdf端点不存在）。
- 实现：①db.py `list_papers`（papers×versions×upload_events三表JOIN→嵌套paper/version/uploads结构，来源=每次上传事件带文件名与时间）+`paper_artifact_sha`（最新版本artifact）；②`GET /api/papers`——库配置时返回嵌套版本列表（repository:true），未配置诚实返回`{repository:false, papers:[]}`，库故障502；③`GET /api/papers/{id}/pdf`——从内容寻址blob store服务**原PDF字节**（解析运行中/失败/完成均可读——blob在上传时已存）；未知404、blob缺失410。
- 绿：test_papers_p11 7测（列表含版本+来源/同文件两上传一paper两来源/不同paper分开/无库诚实空/hang模式解析运行中pdf 200原字节/crash模式解析失败pdf 200原字节/未知404）；全量快集**186过2 deselected**（+7）。
- 诚实登记：paper_pdf服务"最新版本"的artifact（同paper多版本并存是P1.2——当前一paper一version）；hang模式测试依赖 TEST_CONVERT=hang（300s睡，测试在running窗口内断言后由fixture teardown清场）；title_hint来自上传文件名（P1.2接Docling元数据）。
- 证据：docs/verification/P1.1/attempt-1/（red/green/pytest-full-quick）。sha256：db.py=329e923c、main.py=71ff20b4、test=f54d7ba3。
- 下一动作：独立复核→done→P1.2（Docling/VLM产物带parser版本与锚点精度，重解析产生新artifact）。

### D1.3 开工卡与执行记录（2026-11-06㉑，owner：ZCode主会话；状态：done——复核"通过"七项核验（无双写全仓grep+探针/失败语义/upsert/导出恢复自跑实证计数相等/迁移8步恰补/声称吻合）。**复核三建议全部当场处置**：①重启恢复读改走`_get_doc`（PG先+legacy回退——原直读文件令DB模式新job重启丢docId，main.py终值cfa2de15）；②测试4补失败可见性正向断言（repo=dict含error，test终值ee6212c2）；③STATE补记：新job重启丢docId问题已随①修复、**export dump不含imported_docs/imported_runs两表**（D1.2落地数据不在本演练范围——恢复时imported_*从源快照重导即可，登记）。另登记：pytest须从仓库根跑（server/子目录跑ingest_worker子进程cwd解析失败）；workspace无FK（单用户宽松，P1多workspace时加）

- 开工卡：行为=上传消费者切换唯一写权威（PG为写、旧doc JSON不再承担同数据写权威——**边界裁定：engine-runs.jsonl是引擎执行日志非上传消费者数据，其切换属J1**）+中断/切换后导出恢复演练；输入=D1.1/.2 done+PLAN D1行D1.3步；负例=无双写（DB模式下doc-*.json零写入）、PG失败不回落JSON、legacy文件只读可读、导出清库恢复计数相等。
- 红：`red.log`（db_export不存在→collection error）。
- 实现：①db.py迁移8步（documents表：doc_id PK/workspace/provenance/content_sha256/doc_json JSONB）+store_document（upsert最新胜、sha逐写、provenance='pg-authority'）+get_document；②main.py `persist_doc`——DB env存在时**只写documents表**（失败记repo_error，绝不回落JSON写=无双写）；无env时旧JSON路径原样（兼容路径测试钉死）；`_get_doc`——DB模式先读PG、**legacy doc-*.json只读回退**（切换前文档仍可服务）；③`db_export.py`——export_repo（6表快照JSON+计数）/restore_repo（FK父序重建、doc_json dict经dump往返序列化回JSONB cast、计数返回供相等断言）。
- 绿：test_db_d13 5测（①真实消费者：doc入PG provenance=pg-authority、**doc-*.json零写入**、/api/document从PG服务；②legacy JSON只读回退+新解析仍PG-only；③无DB配置旧路径不变；④PG失败无JSON回落；⑤导出→清库→恢复计数相等+文档恢复后可服务）；全量快集**179过2 deselected**（+5）。
- 测试途中自修（非oracle）：status端点路径错（/api/ingest/{id}非/api/status）；export读事务后切autocommit需先rollback；恢复时doc_json是dict需序列化回JSONB。
- 诚实登记：store_document同docId重解析为upsert最新胜（P1做版本化多artifact）；`_restore_jobs`重启恢复读`_doc_path`（DB模式下旧job重启后doc从legacy回退路径找得到——新job走PG；边界可接受，P1统一）；导出dump含upload_events但不含job JSON（job是过程记录非领域数据）。
- 证据：docs/verification/D1.3/attempt-1/（red/green/pytest-full-quick）。sha256：db.py=1e4a2376、db_export.py=dfc1c13d、main.py=cafdb861、test=20da3bf8。
- 下一动作：独立复核→done→D1父项收口→P1/J1解锁。

### D1.2 开工卡与执行记录（2026-11-06⑳，owner：ZCode主会话；状态：done——复核"通过"六项PASS：复核者**自跑真实导入**逐数吻合（11/421+356/暖跑零新行）、hash独立复算一致、356重复行独立统计证实同id同内容逐字重复、迁移6/7步对5版库恰补且no-op、零UPDATE零executor调用；建议的conflict正向hash断言已当场补（原hash存活断言，8测复验，test终值901da247）。理论注记登记：jsonl含\r\n/坏字节时行hash或偏原文（当前数据无）——D1.3留意）

- 开工卡：行为=只读导入旧doc/Run快照（保留原ID与legacy来源精度、数量/hash可校验、迁移可重复执行不造新Run）；输入=D1.1 done+PLAN D1行D1.2步；范围=db.py增迁移6/7两步（imported_docs/imported_runs落地表）+新db_import.py+测试；负例=改文件同名冲突不覆写、坏行只丢自己、重导入零新行。
- 红：`red.log`（db_import不存在→collection error）。
- 实现：migrate 6/7步（imported_docs(doc_id PK/provenance/content_sha256/doc_json JSONB)、imported_runs(run_id PK/status/result_json/record_json/content_sha256)）；`import_doc_snapshots`（glob doc-*.json，docId与文件名一致校验，**原docId保留**，provenance='legacy-json'，sha256=文件原文hash——重导入同id同hash→skipped、同id异hash→**conflict不覆写**、坏JSON→errors不致命）；`import_run_log`（逐行解析，**原runId保留**，legacy数字逐字存JSONB零重算零新Run，同id同hash→skipped/异hash→conflict，坏行只丢自己与engine_persist容错语义同构）；`import_report`（合并计数+每源sha256可独立校验）。
- 绿：test_db_import_d12 8测（11文件/id保留+legacy标注+hash可验/重导入幂等零重复/改文件冲突不覆写/坏JSON计数不致命/Run原id零重算/error Run也导入/坏尾行只丢自己/报告携可验hash）；全量快集**174过2 deselected**（+8）。
- **真实快照导入**（real-snapshot-import.log）：server/data 实际11 doc文件+777行runlog——首轮 docs 11/0错、runs 421导入+356 skipped（**log内同runId同内容重复行**——同hash幂等跳过）+0冲突0错；清表重跑同数（可重复）；暖重跑 docs 0+11skip、runs 0+777skip（零新行）。
- 测试途中自修（非oracle）：docId校验先多套一层doc-前缀；测试读错文件名（doc-aaa vs doc-doc-aaa）；psycopg JSONB列自动解析为dict（json.loads(dict)误用）。
- 诚实登记：356行log内重复=历史requestId缓存下同Run重复append（导入侧以同hash幂等跳过，不改历史文件——D1.3切写权威后不再产生）；imported_*落地表不参与产品读路径（P1消费）；log的sources列表在大量错误行时可长——报告入STATE只存计数。
- 证据：docs/verification/D1.2/attempt-1/（red/green2/green-final/pytest-full-quick/real-snapshot-import）。sha256：db.py=0bea927e、db_import.py=20c253e5、test=fd16bbf6。
- 下一动作：独立复核→done→D1.3（唯一写权威切换+回滚演练）。

### D1.1 开工卡与执行记录（2026-11-06⑲，owner：ZCode主会话；状态：done——复核"通过"六项全PASS（schema语义/内容寻址blob/消费者挂接/测试有效性/范围纪律/声称诚实），探针实证幂等migrate、跨ws分Paper共Artifact、4事件留痕、id碰撞为响亮失败非静默错。**复核登记①.part临时名不唯一已当场修复**（uuid后缀，9测复验过，db.py终值19aabf06）；登记②id 48bit前缀碰撞（响应失败、概率单用户可忽略——回退全hash方案转D1.3顺带）。竞态评估：当前async handler内同步串行无窗口，DB挪线程池/多进程前须重审——D1.3前置）

- 开工卡：行为=为现有上传消费者接内容hash、Paper/Version与workspace索引，实际数据库往返与同文件去重；不提前建全部未来表（Parse/Anchor/Model/Run索引归D1.2/.3）；输入=PG环境门已解除（⑱）、PLAN D1行+§4.1 D1.1；范围=server/db.py+main.py ingest挂接+requirements psycopg+测试；负例=同文件去重保双上传溯源、跨workspace同字节分Paper共Artifact、DB失败记job不静默、无env行为不变。
- 环境：psycopg[binary]3.3.8装入venv、requirements.txt增`psycopg[binary]>=3.2,<4`（B0.3登记的pytest 9/pypdfium2漂移未动）。
- 红：`red.log`（server/db不存在→collection error）。
- 实现：①`server/db.py`——connect（env PAPER2LAB_DATABASE_URL，未配置显式报错）、migrate（版本化schema_migrations，5步附加DDL+回滚注记，幂等重放安全）、ensure_workspace（幂等）、store_paper_upload（sha256内容寻址blob（storage_root/artifacts/前2字符/全hash，原子写.part→replace）、workspace作用域Paper/Version身份——id由hash(workspace:sha)派生（同workspace同字节=同Paper同Version去重，跨workspace=分Paper共全局Artifact）、append-only upload_events每次上传留痕）、get_paper_by_sha、artifact_bytes。每个execute首参为字符串字面量+命名参数绑定（Mimosa多轮拦截变量首参/外置SQL文件方案后收敛的写法，db_statements.sql中间产物已删）。②`main.py` ingest挂接：PDF校验后、env配置存在时真实往返（store+readback校验），repo_record/repo_error进job JSON与202响应体；DB失败记repo_error不阻断解析（D1.3才切写权威）；无env时repo字段为null行为不变。
- 绿：test_db_d1 5测（PG探针skip门）+test_db_consumer_d1 4测（真实ASGI端点：往返+blob落盘+去重双事件+DB失败记录+无env不变）=9过；全量快集**166过2 deselected**。
- 测试途中自修（非oracle）：id派生先漏workspace致跨库主键撞车（真bug红→修）；dict_row键名（id/paper_id、count取法）；fixture DATA_DIR模块级需monkeypatch属性；202非200。
- 诚实登记：migrate的回滚注记仅记录（D1.3写真实回滚路径）；blob存DATA_DIR下（D1.3导出/备份演练）；同workspace同字节不同文件名→同Version+两事件（P1细化多版本并存）。
- 证据：docs/verification/D1.1/attempt-1/。sha256：db.py=83a8e6d1、main.py=1af368b0、requirements=c8733a59、test_db_d1=801ad534、test_db_consumer_d1=0846a30b。
- 下一动作：独立复核→done→D1.2（只读导入旧快照）。

### A0.2 开工卡与执行记录（2026-11-06⑯，owner：ZCode主会话；状态：done——复核两轮：首轮"有条件通过"（L3死代码+comparison无守卫两真缺陷）→梯级重写+三红测→**终审通过**（复核者独立探针：huge-comparison/可达metrics档/六组合矩阵/floor全验证；证据缺口已补齐red2-ladder.log）。终值agent.py=ad1652d8、test_agent_a02=a4f93f5c。**复核转来登记**：lane_b test_resume_guards_round_tool_batch 存在既有测试隔离债（固定sid+默认DATA_DIR→rounds跨运行累积；主Agent运行均用mktemp隔离DATA_DIR故52全过，复核者裸跑复现51+1——转测试隔离修复，归下一B0备份切片或A0收口）；floor runIds[:4]理论残留（单id≈1900字符才越限，引擎id短不可达，注记）

- 开工卡：行为=大结果结构化摘要/制品选择器（超限结果按artifactRef+runId选择器读取、保留完整受权结果、完整性标记）+复核转来_sse确定化aclose；输入=A0.1 done+PLAN A0.2行+A0.1复核建议；范围=agent.py结果制品注册表+_tool_output_json升级+_sse；负例=超限→合法JSON带artifactRef/sha/runIds、错误批次降级保语义、注册表有界淘汰、小结果原样零注册、断开确定关闭内层生成器。
- 红：`red.log`（get_result_artifact不存在→collection error）。
- 实现：①`_RESULT_ARTIFACT_LIMIT=32`插入序注册表+`get_result_artifact(ref)`（返回完整解析副本；未知/淘汰→None）+`_retain_result_artifact`（存全量JSON、超限逐出最老、返回ref+sha256）；②`_tool_output_json`升级：超限→slim携`artifactRef`+`artifactSha256`（sha256(全量JSON)——摘要与保留副本可互验）+`runIds`（引擎run history的持久选择器）+note说明去哪读全量；错误批次保status/message；metrics仅在装得下时附带；③`_sse` gen()加finally`await events.aclose()`——客户端断开时确定关闭内层事件生成器（不再依赖GC的asyncgen finalizer，A0.1锁释放及时性确定化）。
- 绿：test_agent_a02 5测（超限→结构化摘要+全量副本可取回+sha互验；错误批次降级保语义+全量可取；小结果原样零注册；注册表33插淘汰最老保最新；断开→aclose→closed事件1s内+流终止）；回归49过（a01+a02+a13+lane_b+server_mode+tool_surface+engine_api）。红测首跑2失败均为测试自身bug（载荷不够大/循环内未yield），已修并注明。
- 诚实登记：制品注册表进程内（J1持久化）；artifactRef的**读取工具面**（模型经何种工具取回全量）未新增——runIds已可经引擎runs面查询，模型侧显式取回工具归A0.3+按需；_sse的aclose对starlette断开路径生效（复核A0.1指出starlette不显式aclose——现在我们在gen()finally里自己关）。
- 证据：docs/verification/A0.2/attempt-1/（red/red2-ladder/green*/pytest-set*）。sha256（终值）：agent.py=ad1652d8、test_agent_a02=a4f93f5c。
- **复核（⑰）与处置**：复核"有条件通过"抓两真缺陷——①降级梯级L3死代码（with_metrics⊃slim恒更长，metrics档永不命中，较A1.3行为回退）②comparison无尺寸守卫（9k字符comparison→输出9449>8000）。处置：重写为**丰富度递减候选梯级**（comparison+metrics→metrics→comparison→全runIds→floor(runIds[:4])），逐级试穿取首个≤budget者，artifactRef/sha/错误语义每级随行；补三红测（huge comparison≤8000+全量可取回；metrics档真实可达（8×1200全量>8k、末4条≈4.8k装得下）；六组合矩阵全部≤8000+合法+全量可取+错误语义）——红2复现comparison越限后转绿。终值8测+回归52过。
- 下一动作：终审→done→A0.3（缺凭据，提人工问题）或转D1.1。

### A0.1 开工卡与执行记录（2026-11-06⑮，owner：ZCode主会话；状态：done——复核"通过"六项PASS：全局零引用（rg全仓）、session_turn交错封死、**薄壳GeneratorExit经探针实测**（消费1事件→aclose→同session立即可取+第二流跑通）、Lane B断开沿GeneratorExit链释放、SOP路径零接触、测试无flaky。保留：SSE断开释放及时性依赖asyncgen finalizer/GC——机制正确非确定性及时；非必修建议（_sse的gen()加try/finally aclose确定化）转A0.2）

- 开工卡：行为=消除全局`_last_ok_summary`（PLAN §7:1027/1076/1099+1084截断——前二者本轮修）、session串行锁随生命周期释放；输入=A1 done+PLAN A0.1行；范围=agent.py会话运行时+测试；负例=两session交错不串摘要、同session串行、异常后锁可再取得、模块级全局不存在；命令=pytest定向集。
- 红：`red.log`（collection error——session_turn/get_session_summary/set_session_summary不存在）。
- 实现：①新增`_session_summaries`/`_session_locks`两字典+`session_turn`异步上下文（取锁→清摘要→yield→finally清摘要；锁map进程存活——丢弃条目会破坏排队者，J1做会话GC；SSE断开→GeneratorExit→async-with仍释放锁）+set/get_session_summary；②agentscope_stream改为薄壳（整回合在session_turn内，转发事件），原体改名`_agentscope_stream_locked`；③全局`_last_ok_summary`三处引用全部删除（reset→session_turn自动清、set→set_session_summary(session_id)、read→get_session_summary(session_id)），模块级定义已不存在（测试断言hasattr=False钉死）。
- 绿：test_agent_a01 6测（交错隔离/新回合干净启动/同session串行enter-exit-exit-enter顺序/异session并发/异常释放后立即可取/全局不存在）；回归44过（a01+a13+lane_b+server_mode+tool_surface+engine_api）。
- 诚实登记：锁对浏览器Lane B同样生效（同session第二tab等待首个回合结束——§3.2"同Session串行"本义；断连经GeneratorExit释放）；锁map与agentscope session map同生命周期不GC（J1）；摘要消费点在session_turn的finally之前（observation_ready事件在锁内yield——正确：回合结束前才需要摘要）。
- 证据：docs/verification/A0.1/attempt-1/（red/green/pytest-set）。sha256：agent.py=27ff3ad4、test_agent_a01=bd1da93c。
- 下一动作：独立复核→done→A0.2。

### A1.3 开工卡（2026-11-06⑬，owner：ZCode主会话；状态：done，见执行记录）

| 字段 | 内容 |
|---|---|
| 行为/产物 | AgentScope回填/SSE接baseRunId：多回合工具调用从本回合最新Run续算（不再每轮重读原base=R8）；技能错配显式拒绝（不再静默改写op前缀）；错误批次完整回执（含内部失败包络）；同operationId不重复Fork（复用引擎侧账本）。**未实现、显式转出**：expectedExperimentRevision（转J1持久层统一）；晚响应不改目标（串行队列下无窗口，转J1） |
| 输入与依赖 | A1.2 done（操作账本+engine幂等）；PLAN A1.3行、§3.3身份合同、§7 R8/R10；已读锚点：agent.py:1112-1169（_server_run_tool_call：1154每轮重读context.base=R8、1127-1136静默改写op前缀=暗改op、1144-1151空种子plan）、:1040-1082（回填循环：1081行[:8000]截断、1076行全局_last_ok_summary）、:1333-1343（关键词SOP截流=R10）、:461-480（SOP路径run_input链——AI路径缺同等机制）、engine agent_steps op |
| 范围 | agent.py的agentscope_stream服务端执行路径+回填；agent_steps可传baseRunId（engine侧run_input已支持解析）；SSE事件面不变；desk错配改显式error事件+一次指导性重试。不动：SOP路径语义、浏览器Lane B、A0的会话隔离（A0.1做） |
| 正/负例 | 正：a=1→设3→基于新Run×2=6（显式选旧Run则=2且parent正确）；回合内第二次工具调用base=本回合最新Run；错配desk→模型可见的显式error。负：静默改写op禁止；同operationId重复调用零重复Fork；批次部分失败完整回执；[:8000]处改安全截断（完整制品引用归A0.2） |
| 命令/限额 | 红测先行（pytest mock bridge：base链/错配拒绝/幂等）；pytest快集+test_agent_lane_b/test_agent_server_mode/test_agent_tool_surface；引擎bundle按需重建 |
| 完成与恢复 | 证据入docs/verification/A1.3/，独立复核后done，A1收口（父项集成门），转A0.1/.2 |

**A1.3 执行记录（状态：done——三轮复核：首轮"有条件通过"（R8链/错配/operationId/values保真/截断全PASS，两项必修）→处置（内部失败包络+卡面标注）→次轮一项残留（ids-only兜底丢错误语义）→一行修（兜底保status/message，python -I极端场景验证）→**终审通过**。终值：agent.py=5e169d65、test_agent_a13=6fab17e9）**

- 红：`red.log` 5失败（turn_state参数/desk错配调引擎/operationId均不存在）。
- 实现：①agent.py `_server_run_tool_call`增turn_state——成功轮记录本回合最新runId，下一轮传`baseRunId`（不再重读context.base=R8修复）；desk错配从静默改写op改为**显式error**（点名被钉住的desk与正确op前缀，模型可读可重试；不再执行模型未提议的程序）；operationId=sha256(desk,steps,base身份)前16——同批重试同id，引擎账本回放零重复Fork；超时不记录链头（失败轮不毒化链条）。②engine `agent_steps`接`baseRunId`（inputForRun解析，不可解析报错）与`operationId`（进程内账本：同id同digest回放replayed:true、异digest拒；256条FIFO）。③**顺带修真缺陷**：formula.plot的spec.model不记录完整values（独立变量种子/非参数绑定丢失→链式重放无数据）——model增values快照+inputForRun优先model.values（旧Run回退spec.params）；回归测试用非参数符号b钉死（旧inputFromSpec必丢b）。④回填JSON的[:8000]裸截断改`_tool_output_json`：超限降级为结构化slim（truncated/runIds/metrics/comparison），保证恒为合法JSON（A0.2换真制品引用）。
- 验证：pytest新5测（错配显式+桥零调用/链式两轮baseRunId/失败轮不毒化/同批同operationId/异批异id，mock桥协议级）+agent面37过；全量54文件494过；tsc 0。**bridge制品实测**（14f4924c）：round1 set a=3→peak3；round2链上×2→**peak6**（parent=round1 run）、对照原base×2→peak2——R8修复的正反例即PLAN A0.3验收算例（a=1→设3→基于新Run乘2得6）；同id重试replayed同target；同id异payload拒。
- 诚实登记：**TDD顺序违规一处**——values保真修复先于其回归测试落码（测试后补且过；复核时可临时还原executor.ts:114/925验证红）；种子计划+链式base会撞S1.3输入绑定门（期望行为：参数变化须新计划——空种子计划即agent.py现状，无生产影响）；晚响应不改目标未实现（串行队列下无窗口，登记J1）；expectedExperimentRevision字段未实现（J1持久层统一）。
- 证据：docs/verification/A1.3/attempt-1/（red/bridge-chain3/4/pytest-final*/vitest-full）。sha256（终值）：agent.py=5e169d65、test_agent_a13=6fab17e9、engine_server.ts=4a9e9a75、server.bundle=14f4924c、once.mjs=daa187d3、executor.ts=12a82f86、runProvenance.test=bfa79b40。复核者在14f4924c制品上独立复现链式（含b符号更强例：set a=3→peak9、链上×2→peak18、对照→peak6）与replayed/conflict；values保真红性经其分析确认（旧行为两处断言必红）。极端降级保错误的python -I验证在pytest-final3轮（未固化为pytest文件——复核终审接受，登记）。
- **A1父项收口**：三子项done（A1.1一致性/A1.2幂等与冲突/A1.3链式与包络）；父项证据=同参数端口vs直调一致Run✓、错误/未知工具/幂等回放/冲突/内部失败包络/安全截断✓；**晚回执负例显式转J1**（串行队列无窗口，卡面标注）。**A1 done。**

### A1.2 开工卡（2026-11-06⑫，owner：ZCode主会话；状态：done，见执行记录）

| 字段 | 内容 |
|---|---|
| 行为/产物 | 统一invocation/operation身份与回执：同一operationId+幂等键重复调用返回既有回执；同键异payload拒绝（409语义）；未知工具拒绝；调用方（agent.py工具桥路径）切换到tool_execute回执面且SSE事件不变 |
| 输入与依赖 | A1.1 done（toolPort+engine双op）；PLAN §3.1调用合同、A1.2行、§4.1；server/agent.py:1112起的服务端工具执行路径、engine_api.py requestId缓存（#31进程内实现是基础） |
| 范围 | toolPort.ts增操作身份/幂等缓存（进程内，J1前不承诺跨重启）；engine_server tool_execute接幂等；agent.py Lane B/SSE路径逐步对齐（不扩张意图正则）；制品重建。不动：S1冻结语义、A1.3的AgentScope回填细节 |
| 正/负例 | 正：同operationId同payload两次=同一回执零重复Run；负：同operationId异payload→拒绝；未知工具→unknown_skill；断线重放同键→回执不重执行 |
| 命令/限额 | 红测先行（toolPort幂等/冲突）；S1定向集+新增；pytest test_agent_tool_surface/test_engine_api |
| 完成与恢复 | 证据入docs/verification/A1.2/，独立复核后done，转A1.3 |

**A1.2 执行记录（状态：done——复核"有条件通过"，两项必修已处置：①needs_input/unsupported不再缓存（未执行的操作不算操作结果，operationId不卡死——测试op-8钉死）+回放不泄露首调invocationId（op-9）+STATE边界三句已补；②其余见下）**

- 红：`red.log` 16测7失败（invokeScientificOperation/resetOperationLedger 不存在）。
- 实现：toolPort.ts新增`ScientificOperation`（operationId/idempotencyKey/workspace默认单用户）与`invokeScientificOperation`——进程内操作账本（512条LRU；键=workspace|operationId|idempotencyKey；payload身份=planInputDigest(skill,input)规范化，键序不产生假冲突）；同键同payload→回放既有回执（replayed:true、runId同一、零重执行，**失败回执同样缓存**——重试返回同一失败不重跑）；同键异payload→`operation_conflict`拒且不执行；未知工具为协议级错误**不烧掉operationId**；resetOperationLedger供测试。engine `tool_execute` op接operationId/idempotencyKey/workspace（无operationId走原单发路径不变）。
- 调用方核对：agent.py只走bridge `agent_steps`（无直连execute）——A1.2无需切换，SSE面不变；A1.3做回填对齐。
- 绿：toolPort.test 16过（幂等回放/冲突/未知不占键/幂等键区分/workspace隔离/失败缓存/进程内重置）；全量54文件491过；tsc 0；pytest test_agent_tool_surface+test_engine_api 20过。**bridge制品实测六例**（bridge-idempotency.log，60204751制品）：同键重试回放同runId+replayed、篡改operation_conflict、新幂等键真执行、未知工具后同operationId可用。
- 证据：docs/verification/A1.2/attempt-1/。sha256：toolPort=78d2c08b、toolPort.test=037b9ff9、engine_server.ts=8ba4998a、server.bundle=60204751（once.mjs=28d454c1未变）。
- 已知边界：账本进程内（重启即空、不承诺跨重启幂等——J1持久化）；**FIFO驱逐（512条按插入序，非LRU——STATE初写"LRU"为措辞误）后同键重试会重新执行**；**无operationId的单发路径=幂等旁路**（调用方可无限重执行，PLAN A1.2未强制操作身份，J1收紧）；并发in-flight去重未做（单进程串行队列下无窗口；HTTP层#31 requestId仍并行存在，J1统一）；同键冲突且内联plan异内容时先报invalid plan遮蔽operation_conflict（轻微，登记）。
- **独立复核**：只读reviewer（24次工具调用，冻结hash五项匹配，经60204751制品实测键序回放）"有条件通过"——两项必修已处置（needs_input不缓存+回放清id，代码级），边界三句已入上一条；修复后18+493全过、tsc 0、制品第八建（server.bundle=441a647e）。复核者判定：payload身份不含planId/opts为正确语义（回执携带首调planId的辨析风险登记）。**状态done。**
- 下一动作：独立复核→done→A1.3。

### A1.1 开工卡（2026-11-06⑩，owner：ZCode主会话；状态：active——Q-S13-1等待期间的ready工作，PLAN §4.2允许）

| 字段 | 内容 |
|---|---|
| 行为/产物 | 从现有Registry导出框架无关的科学工具调用/回执/权限端口：同一科学调用经端口与原executor得到语义一致Run；AgentScope与现有SSE保持兼容 |
| 输入与依赖 | B0.3 done（Python基线）；PLAN §3.1工具面合同、§4.1 A1.1、A1行；server/agent.py的scientific_execute schema生成处、engine skills op、registry.ts @HEAD；研究02 §4.1/§7 |
| 范围 | 新增src/skills/toolPort.ts（或等价位置，先读agent.py定形）+服务端适配；不改executor内核语义；不动S1.3冻结文件（playPlan/executor已含S1.3修复，改动需在S1.3收口后）。**注意：A1.3（AgentScope回填/baseRunId）之前不做，因A1依赖S1 done才能签收** |
| 正/负例 | 正：同参数经端口与直调executor结果语义一致（runId可异，数值/血缘/来源一致）；负：未知工具拒、权限外拒、错配拒——错误路径与现行为一致 |
| 命令/限额 | 先红：端口一致性测试；绿：S1定向集+新增；Python面test_agent_tool_surface.py |
| 完成与恢复 | 证据入docs/verification/A1.1/，独立只读复核后A1.1 done（A1父项签收需A1.2/.3完成） |

**A1.1 执行记录（状态：done——合并复核A/B/C全PASS：toolPort字面调executeSkill无旁路、回执四态映射完整、engine plan冲突语义与execute一致、无第二清单/执行器；三处收尾修：头部状态、S1行碎片、once-final-recheck.log终态复验归档。复核者nuance记录：点号案在schema丢未知键形态下以未篡改值放行，结构性比对封的是扁平伪造形态——防护成立，措辞已按此理解）**

- 红：`red.log`（模块缺失，no tests）。
- 实现：新增`src/skills/toolPort.ts`——toolCatalog()（15技能全量：name/aliases/version/evidence/runKind/**input+output schema**，portVersion=tool-port@1.0，无第二份清单）；invokeScientificTool()（字面调用executeSkill并翻译为PLAN §3.1回执信封：completed/needs_input/unsupported/error + errorCode/missingFields/invocationId回显/错误Run随回执——**无第二执行器**）。engine_server.ts新增`tools`（全目录）与`tool_execute`（回执；内联plan先注册、门不放宽）两op，原`execute`/`skills`不动。agent.py未改（A1.2/.3做调用方切换与回执统一）。toolPort直调executeSkill时公共replay丢弃语义自然继承。
- 绿：toolPort.test 9过（端口vs直调同证据/result/status/source/engine深等；别名measure_volume→kakeya.voxel；unknown_skill/needs_input/invalid_input/execution_failed全映射；invocationId回显）；全量54文件484过；tsc 0。**bridge制品实测**（a58a3f54）：tools op（15工具+schema在场）→tool_execute正例（completed/value 6/source落spec/inv回显）→未知工具（error/unknown_skill）→篡改输入（needs_input/plan.inputs——S1.3的门经端口同样生效）。
- 证据：docs/verification/A1.1/attempt-1/（red/green/vitest-full/bridge-tool-ops.log）。sha256：toolPort=7dc4fa6a、toolPort.test=bbebb75e、engine_server.ts=a8374184、server.bundle=a58a3f54（once.mjs=28d454c1未变——不依赖toolPort）。
- 下一动作：独立复核（与PLAN修订/S1收口合并一轮）→A1.1 done→A1.2。

### S1.3 开工卡（2026-11-06⑥，owner：ZCode主会话；状态：done——代码必修三轮处置+制品实测过，Q-S13-1裁定后按修订PLAN收口）

| 字段 | 内容 |
|---|---|
| 行为/产物 | 计划绑定本次输入：执行时核对已注册计划的canonical input digest与实际输入一致（拒同planId异输入）；registerPlan同planId异内容报冲突；公共execute入口的replay开关收紧为仅内部Fork/Replay路径可设；HTTP/桥/once入口透传source；once/bundle制品随S1.1+S1.2源码重建并以真实HTTP执行验收 |
| 输入与依赖 | S1.1 done（S1.2实现已就绪、复核中）；PLAN §3.3"计划绑定分两步"（S1绑定canonical digest+source+parent+预算；N1才绑模型revision；**预算字段本轮未实现，登记延后N1——S1.3开工卡引述与实现的差异**）、§4.1 S1.3、12章§1（registerPlan同ID异内容不报冲突、无统一操作身份）；engine_api.py/engine_server.ts/engine_once.ts @HEAD |
| 范围 | playPlan.ts（canonical JSON+digest+冲突检测+inputs比较）、executor.ts（digest门+replay收权+fork传source）、engine_server.ts/engine_once.ts/engine_api.py（source字段透传）、Dockerfile重建段核对；测试补playPlan.test/executor.test/engine面（pytest）。不动：预算字段（登记，D1/J1持久预算）、runKind/spec.params补全（values入params是行为变化，登记U1）、A1工具端口 |
| 正/负例 | 正：同plan+同输入执行通过（幂等重注册等价planId不冲突）；fork的`fork:runId`计划路径工作；HTTP execute带source落到Run。负：同planId+不同input→needs_input/拒绝且不执行；同planId异内容registerPlan→冲突报错；外部execute传replay:true被忽略/拒绝；missing plan仍拒 |
| 命令/限额 | 红测先行（playPlan digest/冲突、executor digest门、replay越权）；绿：S1定向测试集+`pnpm test`+`tsc -b`；重建制品：esbuild命令按Dockerfile同源；pytest快集（engine面）+ASGI真实execute带source断言 |
| 完成与恢复 | 证据入docs/verification/S1.3/，独立只读复核后done，S1收口（15章19断言+主路复跑）。限制：本机Node 25；digest是规范化JSON哈希（无密码学承诺），跨进程一致 |

**S1.3 执行记录（状态：verifying）**

- 红：`red.log` 8测试4失败（冲突检测缺、同plan异输入放行、公共replay绕门）。
- 实现：①playPlan.ts——canonicalJson（键排序）+planInputDigest（SHA-256，复用artifacts实现，浏览器/Node同源）；registerPlan同planId异内容抛"plan conflict"（等价内容幂等返回原计划）；planCoversInput（digest相等→过；否则种子每个叶子须在派发输入同键深相等；空种子=族合同只受覆盖门——注释指明N1绑修订）。②executor.ts——executeSkill成为公共门（丢弃调用方replay），新增executeInternal供fork/replay物化路径；计划门加planCoversInput（needs_input/plan.inputs）。③engine_once.ts argv[7]=source（JSON容错exit 2）；engine_server execute op透传source；engine_api ExecuteRequest.source字段+once argv[7]+bridge source kwarg。④challengeStore/odePhaseStore计划种子改空+注释（族合同，操纵量归N1）。⑤**制品重建**：esbuild 0.28.2按Dockerfile同命令重建engine_once.mjs(102592B)/engine_server.bundle.mjs(114755B)——服务端路径自此携带S1.1+S1.2+S1.3。
- 验收（真实执行）：once直跑=plan门过+value 6+source落spec；bridge协议=冲突重注册ok:false"plan conflict"+execute带source+篡改输入needs_input无run；**真实HTTP（uvicorn 8891+重建once制品）**：正例ok/6/source完整/kind=formula.value（runKind漂移同步修复）；篡改输入needs_input；同requestId两次同runId（幂等）；无source时spec无source键。pytest引擎面21过。
- 回归：全量53文件461测试0失败；tsc -b 0。agent.py远程计划不带inputs→空种子豁免，服务端agent路径不受影响（pytest证实）。
- sha256前缀（实现时快照；playPlan与engine_server.ts经复核修复已变为3512ea68/1adb6ba1，once.ts=b0554098、executor=9ced1dce、engine_api=e7880266未再变；once.mjs首建4df12c9d、server.bundle首建9f50e8ac为陈旧值——最新制品89fdca69/364c2802，见复核段；planBinding.test=ad28b9cb、challengeStore=9773f28b、odePhaseStore=a02edd95。
- 已知边界（登记）：计划注册表仍是进程内存（once每请求新进程→跨HTTP请求的计划冲突检测需D1持久层；同请求内与常驻bridge进程内已检测）；参数变化的族计划（拖芯片）在N1前不换计划——覆盖门+digest叶子只绑种子不变量；**预算字段（PLAN §3.3执行预算）本轮未实现，延后N1**；`{a:undefined}`内存种子canonical化为`{"a":null}`成非空种子（fail-closed，仅内存构建器可达）；STATE早期记录中once/bundle前缀4df12c9d/9f50e8ac为第一次重建的陈旧值（可追溯）。
- **复核（⑨⑩三轮）终局**：全部代码必修处置并经复核者在28d454c1/a7ff191c制品上实测（点号伪造拒、ode.phase无计划拒、475过、render-webgl PASS）。**复核结论：S1.3代码通过，但5项合同归属（预算/异源-parent-版本绑定/fork核对深度/空种子语义/once跨请求）是PLAN合同变更，复核者明示需用户裁定——已挂Q-S13-1。**制品终值once.mjs=28d454c1、server.bundle=a7ff191c；源码终值playPlan=e0b9230b、executor=17bc2bb8。第三轮代码修复明细误排于S1.2执行记录内（复核指出的记录问题，内容属实，此处指向）。
- **收口（⑪）**：Q-S13-1 applied（来源与会话续行指令采纳推荐同录于问题队列）；PLAN四行已修订（S1行改写+J1/N1/D1各行新增移入项）。S1.3合同残余按裁定转移：预算→J1、异源/幽灵parent/错版本→N1+D1、fork深核对→D1、空种子→S1合法语义+N1收紧、once跨请求→D1。**S1.3 done。**
- **S1父项收口**：三个子项全done（S1.1/S1.2/S1.3各有独立复核）；包内集成门=①15章19断言（executorProof.test，475全过内）②受影响主路全量pnpm test 53文件475（vitest-full-fix2.log）③真实浏览器render-webgl PASS（render-webgl-fix.log）④pytest引擎面28过（pytest-engine-fix.log）⑤once制品实测（正例+点号伪造拒）——全部在终态代码（playPlan=e0b9230b/executor=17bc2bb8/protocol=80730432）与终态制品（28d454c1/a7ff191c）上。**S1 done。**

### S1.2 开工卡（2026-11-06⑤，owner：ZCode主会话；状态：verifying）

| 字段 | 内容 |
|---|---|
| 行为/产物 | 每个技能的正式输出都按registry校验，形状不符记error Run（code=output_invalid）且不带result；runKind与实际kind一致；nullable如实声明；Run内联结果只收JSON值，二进制走封存制品引用；错误输出进不了图表/Goal |
| 输入与依赖 | S1.1 done；13 §1、15 §1（runKind/period0漂移）、compiler-code-audit §5（generate/challenge schema与实际不符）、implementation-review R4、PLAN §3.3“科学制品边界”；protocol.ts、registry.ts、executor.ts、kakeyaGraph.ts |
| 范围 | 改protocol.ts、registry.ts、executor.ts、两个runner、kakeyaGraph.ts（voxelCell是唯一把Uint16Array放进Run的路径，作为制品合同的真实消费者）、canvas/nodes.tsx与spike/SpikeApp.tsx（读取适配）；新增src/experiments/artifacts.ts及测试。不动：D1持久化（制品先存进程内）、S1.3计划绑定、once/bundle重建 |
| 正/负例 | 正：全技能真实输出过schema、runKind==spec.kind、period0可null；封存后改原buffer不影响证据、JSON往返保dtype/shape/hash。负：NaN数组/裸TypedArray/共享buffer/Map/Date/函数/bigint拒绝；形状不符→output_invalid无result；篡改dtype/shape读取拒绝 |
| 命令/限额 | 先红：新测试在未改源码时跑一次存证；后绿：`pnpm exec vitest run src/experiments src/skills/outputContract.test.ts`+PLAN §4.2 S1入口；收口`pnpm test`、`pnpm exec tsc -b`；Kakeya 3D占据体有UI适配，跑单浏览器真实渲染与Console |
| 完成与恢复 | 证据入docs/verification/S1.2/，独立只读复核后done，转S1.3。ode.phase的system.params改为显式拒绝（内核不绑定） |

**S1.2 执行记录（状态：done——三轮独立复核，终审"可签done"；M2回归/记录残留/render-webgl复跑均已于签收前补齐）**

- 红（未改源码）：`red.log` 51测试34失败——protocol门（16例非法值中14例放行为resolved，仅裸NaN/Infinity被旧assertFiniteNumbers拒绝；红因缺output_invalid分类）、runKind漂移（formula.evaluate注册formula.curve）、period0声明number、kakeya.generate/challenge schema与实际不符、output_invalid分支从未产生、voxelCell无封存。
- 实现：①protocol.ts `sealResult`——Run内联结果只收有限数/串/布尔/null/普通对象/数组，TypedArray/ArrayBuffer/SharedArrayBuffer/DataView报"binary value…seal it with sealArray"，Map/Set/Date/类实例/函数/bigint/undefined拒绝，对象undefined字段丢弃；executeSpec先封存再可选`validateOutput`门，失败记error Run（ExperimentExecutionError带code：execution_failed vs output_invalid）且result=undefined；registerImportedRun/importRuns同门。②新增`src/experiments/artifacts.ts`：sealArray(dtype/shape/byteLength/sha256内容hash/engine，自实现SHA-256供浏览器与Node同源；封存复制字节、读取再复制、SharedArrayBuffer拒绝、浮点非有限拒绝、shape必须恰描述元素数、子范围视图按实际字节)、readArtifact（dtype+shape+hash三重匹配才返回副本）。③registry：全部15技能outputSchema改与真实输出逐字段一致（formula.evaluate runKind改formula.value；period0/pendulum measuredPeriod等声明nullable；kakeya.generate改数组schema；challenge改oneOf三形；ode.solve/geometry.2d补required）；schemaError支持type数组与oneOf。④executor：dispatch构造gated opts（含outputGate(schema)），11个compute全过门；fork/compare/trace的payload过schema（output_invalid不放行）；kakeya.sweep子Run用kakeya.measure的schema；catch区分execution_failed/output_invalid。⑤ode.phase显式拒绝非空system.params（内核不绑定，静默忽略=假参数）；registry inputSchema移除该字段。⑥voxelCell：visGrid经sealArray封存进Run（VoxelRunResult），`materializeVisGrid`给渲染器一次性Uint16副本（WeakMap按run缓存，effect不随渲染重建）；nodes.tsx/SpikeApp适配；metrics.ts/forks.ts类型收窄到VoxelMetrics。
- 修真测试bug（顺带）：render-webgl-test.mjs的cpp按钮选择器命中了同为.cpp-load-btn的扫描开关且不等待done态——改按“高规模已载入”标签选button并waitForFunction。
- 绿：焦点65过（outputContract 25+artifacts 14+protocol 24+kakeyaGraph 2）；全量52文件452测试0失败；tsc -b 0；build ✓；**真实浏览器（生产包+SwiftShader）render-webgl PASS**：拖拽写回packing 0.00→0.60、|⋃T|0.6149→0.4904（本运行值，无改前浏览器基线；占据体showVoxels路径未被断言，标未验证）、63个C++ runs导入、console 0错误——即占据体可视化在封存制品下完好。
- 证据：docs/verification/S1.2/attempt-1/（red/green-focus/vitest-full/build/render-webgl日志）。sha256前缀：protocol=623c2882、artifacts=779a7d9f、registry=94d6d4ff、executor=9046b31c（**后被S1.3改动失效，见增量复核**）、kakeyaGraph=108634f1、nodes=0722e2b4、render-webgl=84509fdd、outputContract.test=64354a94、artifacts.test=bc0a43ea。
- **记录更正（2026-11-06⑦自查+⑧⑨复核证实，原文误写已就地改写）**：①焦点集构成更正为25+14+24+2；②|⋃T|数值为本运行值，无浏览器基线对照（原文行已改写）；③占据体路径未断言、标未验证（原文行已改写）；④红态实况：16例非法值中**14例在旧门下放行为resolved**（TypedArray/ArrayBuffer/SharedArrayBuffer/DataView/Map/Set/Date/类实例/函数/bigint/undefined数组元素/NaN数组/无result/undefined字段保留），仅裸NaN与Infinity被旧assertFiniteNumbers拒绝——红因缺output_invalid分类而非“多数已拒”；⑤“同门”说法不准确：导入路径无技能级schema校验（登记④），“同门”仅指status/result/errors一致性与sealResult数值门。
- **独立复核（增量，2026-11-06⑧）**：只读reviewer（54次工具调用，在内存反向还原S1.3改动后于9046b31c等价版本上跑探针，结论可与S1.3分开）——**有条件通过**：主路径（含Goal消费者）的门成立，但4项必修+登记更正。已全部处置：
  - M1（导入路径）：registerImportedRun/importRuns补status/result/errors一致性门（error带result、resolved带errors、非法status、error无消息全拒）；sealValue拒绝`__proto__`键（原型污染）；precomputedRuns只取resolved；新增4+1回归测试（error Run带result导入后图表出现数值的正例攻击已封）。
  - M2（sweep子Run不合格报execution_failed）：~~S1.3的catch已继承err.code，本轮验证通过~~（复核证伪：executor层catch拿到的是外层executeSpec重贴的execution_failed；真修复在protocol.ts的executeSpec catch继承嵌套ExperimentExecutionError.code，见第二轮）。
  - M3（cpp按钮finally假done）：改为成功才置done，失败回idle。
  - M4（记录更正）：见上条+下方更正；registry补geoms.items；artifacts keyOf并入byteLength/engine/engineVersion（伪造元数据读不出）。
  - 登记更正：登记①改写——"服务端直调runner"不存在，实际缺口=dispatch不复检runner内部executeSpec的opts转发+once/bundle制品门依赖制品新鲜（本轮已重建）；登记②补perronCell/sweepCell/solutionCell/PhysicsLab；runRepository.ts入冻结清单（da95a662）；S1.3卡“S1.2 done”字样已改。
  - 建议登记（未修，转后续）：error Run以0进Agent规划历史（PaperModeNode.tsx:106、PaperDesk.tsx:495）；run3dStore测量失败仍resolved留旧指标（:114，PLAN U1.1已含）；占据体浏览器断言（showVoxels路径）未验证——render-webgl未覆盖，标未验证。
- 修复后回归：53文件466测试全过（+5 M1回归）；tsc 0；once/bundle制品随修复重建。修复涉及文件sha256前缀：protocol=1320bae0、runRepository=da95a662、artifacts=8229779f、registry=7ad3de61、precomputedRuns=9bc8f794、nodes=95211eef、protocol.test=cefdd23f。~~状态：done~~ **退回verifying——复核终审发现二轮必修（见下）。**
- **第二轮复核（⑨）与处置**：①M2真根因=executeSpec的catch对嵌套executeSpec（sweep子Run）抛出的已分类异常重新贴execution_failed——已在executeSpec catch中继承`err instanceof ExperimentExecutionError ? err.code`（protocol.ts），sweep子Run不合格现报output_invalid；②M1原子性回归=runRepository预检不全致good先行入库——抽出`validateImportedRun`为唯一断言（registerImportedRun与importRuns共用；importRuns先全量验证零副作用再注册），并拒stale/computing带result（NaN/TypedArray随sealResult拒）；③artifacts keyOf改JSON.stringify（`["2x3"]`与`[2,3]`不再碰撞）+readArtifact复检shape正整数；④__proto__/keyOf/原子性/重提交幂等补回归测试（+5）。回归：53文件471全过、tsc 0；**制品第四次重建**（once.mjs=89fdca69、server.bundle=364c2802）并复验once正例。新增sha256：protocol=80730432、runRepository=0c8baa4e、artifacts=7f338cde。**状态：verifying，待终审增量复核。**
- **第三轮（⑩，终审必修处置）**：①点号键绕过（种子{bindings:{a:2,x:3}}+顶层字面量`"bindings.a":2`键满足扁平叶子比对→81放行）——planCoversInput改为**结构子集比对**（递归：计划种子每个键在输入同位置深相等；扁平化删除）；②ode.phase补进FORMAL_SKILLS（此前无计划可跑）；③fork物化路径加`hasPlanCovering(skill)`门（无任何计划覆盖该技能的ghost fork拒绝，§3.3"内部Replay仍核对权限"）；④M2回归测试补齐（嵌套output_invalid/execution_failed双例）；⑤render-webgl复跑（本轮，PASS/console 0错）+pytest引擎面复跑（28过）。回归：53文件475全过、tsc 0；**制品第五次重建**（once.mjs=28d454c1、server.bundle=a7ff191c）——once正例复验过，**点号伪造经制品实测被拒**（needs_input/plan.inputs）。本轮sha256：playPlan=e0b9230b、executor=17bc2bb8。**S1.3合同残余（登记，不静默缩小）**：异源fork/幽灵parent（伪造一致Run导入后fork——现被③的plan门挡住无计划情形，有计划时仍可）与错skillVersion核对、once跨请求同planId换内容、空种子族合同策略、预算字段——归属N1（模型修订+异源+版本）、D1（操作账本+落库校验+跨进程计划）、J1（预算），已在开工卡与边界条目列明；**判定这些归属是否成立属合同变更，待用户或PLAN修订确认，S1.3不据此自行签收**。
- **数值不变说明**：voxelCell新增封存步骤不改度量值（|⋃T| 0.6149/0.4904为render-webgl本运行值；内核代码未动）。
- 登记未修（按复核更正）：①runner内部executeSpec的opts由runner转发（现两个runner都转发），dispatch不复检——若未来runner忘记转发opts则门失效（A1统一工具端口时在dispatch复检+制品内含门）；②无schema门的路径分两类：**手工构造Run envelope的**（kakeyaGraph的tubesRunCell/voxelPreviewCell/perronCell、PhysicsLab的live-session录制Run）与**直接调executeSpec绕过executeSkill的**（kakeyaGraph的sweepCell、odeGraph的solutionCell——走数值边界门但无outputGate与计划门；S1.2范围外，U1审计）；③D1前封存制品仅进程内；④导入的Run不做技能级outputSchema校验（导入方无技能上下文；resolved的y为字符串可入图、result:null令图表cell报错——**D1持久层尚无此门，须D1实现engine侧落库校验，此处原文"D1已有门"为误写**）。
- 下一动作：独立只读复核→done→S1.3。

### S1.1 开工卡（2026-11-06④，owner：ZCode主会话；状态：done）

| 字段 | 内容 |
|---|---|
| 行为/产物 | 全部计算技能的Run都保留调用方source；fork保留parentRunId并继承source；replay保留source且不设parent；缺来源不造假；error Run同样保留来源与血缘。数值不变 |
| 输入与依赖 | B0.2 done（Node基线）；15 §1、mathworld/executor-proof/probe.ts（19断言原输入与oracle）+REPORT、next-stage/compiler-code-audit §5；executor.ts、protocol.ts、registerMujocoRunner、registerChallengeRunner @HEAD 37352d9 |
| 范围 | 改executor.ts、registerMujocoRunner.ts、registerChallengeRunner.ts；新增src/skills/executorProof.test.ts（19断言移植）、src/skills/runProvenance.test.ts（全技能表格）。不动：registry/PlayPlan（S1.2/S1.3）、once/bundle重建（S1.3）、旧Kakeya手工envelope（kakeyaGraph/odeGraph不走executeSkill，登记待S1.2/U1）、paperSpec脏文件 |
| 正/负例 | 正：19断言全过且oracle不改；表格逐技能过source/fork/replay。负：不给source时spec.source为undefined；replay不设parentRunId；error Run带source与parent；缺数值时报错不造假 |
| 命令/限额 | 先红：`pnpm exec vitest run src/skills/executorProof.test.ts src/skills/runProvenance.test.ts`并存证；后绿同命令+PLAN §4.2 S1入口；收口`pnpm test`、`pnpm exec tsc -b` |
| 完成与恢复 | 红绿日志入docs/verification/S1.1/，独立只读复核后done，转S1.2。静态预判（待红测确认）：perron-tree、mujoco、challenge丢source；replayRun丢source；ode.phase无inputFromSpec分支、packing/deltaExp扫描replay缺nTubes |

**S1.1 执行记录（状态：done）**

- 红（未改源码）：`red.log` 78测试29失败。历史两项如期复现：`scalar fork lineage preserved`、`scalar source preserved`；其余17项历史断言通过。全技能表格另确认：perron-tree、mujoco、challenge丢source，replayRun对所有技能丢source，ode.phase不可replay/fork，packing扫描不可replay，error Run丢source与parent。
- 测试输入更正（非oracle）：首轮perron的alpha=0.5被内核拒绝（要求(0.5,1]）、phase ode用了内核不绑定的符号k，属我写错的输入，改为alpha=0.7与字面系数ODE。为防“改输入后就不红”，在HEAD原始源码的临时副本上单独重跑这两例：8测试5失败（`red-corrected-inputs-against-HEAD.log`），确认它们确实测到缺陷。19断言的输入与oracle逐字沿用probe.ts，未改。
- 修复：executor.ts——scalar分发传opts、runFormulaEvaluate传parentRunId并去掉默认空opts（防再次漏传）；perron-tree写source；replayRun传source且不设parent；新增ode.phase的inputFromSpec与fork分支（只允许改初值）；sweep的inputFromSpec带nTubes。registerMujocoRunner、registerChallengeRunner写source。
- 绿：焦点集`green-final.log`；全量`pnpm test` 50文件390测试全过（基线312+新增78，既有测试未改一条）；`tsc -b`退出0。
- 证据：docs/verification/S1.1/attempt-1/。sha256前缀：executor.ts=f3e219cc、registerMujocoRunner=3f2af23c、registerChallengeRunner=e6381346、executorProof.test=eaa273f8。
- **发现但本项未修（登记）**：①ode.phase的`system.params`被内核完全忽略而registry声明为绑定（compileOdeRhs只传状态），带符号系数的论文ODE无法运行→S1.2处理合同；②HTTP/桥入口根本不传source（engine_api请求体、engine_server、engine_once均无此字段），服务端Run目前无法带来源→S1.3/A1；③kakeyaGraph、odeGraph手工cell不走executeSkill故无source→S1.2/U1审计；④once/bundle制品尚未随本次源码重建，**服务端运行路径未修复**→S1.3重建并实测。
- 下一动作：独立只读复核→done→S1.2。
- **独立复核**：只读reviewer（41次工具调用，自跑焦点78与全量390）结论“通过，可签S1.1 done”，七项PASS无必须修正。补登记：⑤sweep子Run的parentRunId指向sweep的父而非sweep本身（子Run先于sweep runId产生，HEAD既有行为）；challenge的fork无数值参数面，只测血缘。未验证：服务端实际路径（归S1.3）、Node 22。**状态done。**

### B0.3 执行记录（2026-11-06③，owner：ZCode主会话；状态：done）

| 字段 | 内容 |
|---|---|
| 行为/产物 | pnpm test只收集产品测试（实测48个），研究归档上游测试（实测533个进入默认收集）一个不进；dev依赖扫描不爬研究html（实测入口含docs/research下89个）；冻结锁安装；vitest与build基线，失败逐项分类 |
| 输入与依赖 | B0.1 done；HEAD 37352d9+用户脏文件paperSpec.ts；已装vitest 3.2.7（实读dist/chunks/defaults与config.d.ts：configDefaults/mergeConfig）、vite 7.3.6（实读config.js computeEntries/globEntries）；PLAN §4.1 B0.2、§7末段、implementation-review末段。Context7工具API Key无效，改读已装源码，已记限制 |
| 范围 | 新增vitest.config.ts；vite.config.ts增optimizeDeps.entries（产品html入口实测仅index.html一个，行为不变）；证据写docs/verification/B0.2/；STATE。不改package.json/锁、不动paperSpec.ts、不删研究材料、不在本项修旧失败（归S1等） |
| 正/负例 | 正：48个产品测试仍全部被收集（与隔离前逐行比对）；负：docs/research进入收集=0、dev扫描入口=0；不得用skip/缩集合/放宽阈值修绿；vite build不依赖vitest配置 |
| 命令/限额 | pnpm install --frozen-lockfile；pnpm exec vitest list --filesOnly；pnpm test；pnpm build；git status核对锁/package.json不变。单命令上限10分钟 |
| 完成与恢复 | 版本/退出码/失败清单入证据目录，独立只读复核后done，转S1.1。环境差异：本机Node 25.4.0，CI/Docker为Node 22，基线如实标注；Node 22本机未装 |

**B0.2 执行记录（状态：done）**

- 修改：新增vitest.config.ts（mergeConfig(vite.config, test.exclude=[...configDefaults.exclude,'docs/research/**'])，vite build不读它）；vite.config.ts增`optimizeDeps: { entries: ['index.html'] }`。sha256：vitest.config.ts=4514edaf…、vite.config.ts=2831db94…；package.json=4b146555…与pnpm-lock.yaml=ed5c8afe…未变（与context-repair校验身份一致），paperSpec.ts未动（dade8284…）。
- 收集隔离：改前`vitest list --filesOnly`共581个（docs/research 533个、产品48个）；改后共48个、docs/research 0个，与改前产品集合逐行`diff`一致。
- Dev扫描隔离：改前crawl入口=index.html+89个docs/research html；改后（`--force`新扫）入口仅index.html。发现依赖集合改前后均17项、`comm`无差异，产品预打包行为不变。**测量更正**：我第一次“改后”结果无效——上一轮残留的自启vite进程（pid 43217）占着5199端口，新进程启动失败，日志自然不含docs/research；已核对进程命令行后结束该进程，上述数据来自重测。
- 冻结安装：`pnpm install --frozen-lockfile`退出0（Lockfile is up to date，Already up to date）。
- 基线（Node 25.4.0/pnpm 10.30.2/vitest 3.2.7/vite 7.3.6）：`pnpm test`退出0，48文件312测试全过、0失败0skip，13.4s；`pnpm build`（tsc -b && vite build）退出0，8.1s（用户脏文件在内）。**无旧失败可分类。**日志中`--localstorage-file`警告来自Node 25，engine-persist“skipped corrupt line”是其测试刻意注入的场景。
- 证据：docs/verification/B0.2/attempt-1/（list前后、scan前后、依赖集合、vitest/build日志）。
- 限制：基线在Node 25.4.0上跑，CI/Docker的Node 22未在本机复验；历史“CI runner分配失败”未核对现状；未跑Python（B0.3）、未启动产品服务。
- 下一动作：~~独立只读复核→done→S1.1~~ 已完成。
- **独立复核**：只读reviewer（Explore，47次工具调用，实读已装vitest/vite源码、CI、Docker）结论“通过，可签B0.2 done”：六项全PASS，无必须修正项。两条建议已处理：证据补pnpm-install-frozen.log与exit-codes.txt（退出码由调用shell打印，日志本身不含）；pnpm-lock.yaml在00:34的mtime来自本会话一次只读探测`pnpm install --frozen-lockfile --offline --lockfile-only`，内容hash不变。**状态done。**
- **提交顺序约束（待用户授权提交时生效）**：vitest.config.ts与研究归档目前都未跟踪；归档内含9个嵌套.git与上游pnpm-workspace。提交时vitest.config.ts必须先于或同批于归档，否则CI会把上游测试收入集合。

### B0.3 执行记录（2026-11-06③，owner：ZCode主会话；状态：done）

- 开工卡：行为=固定pytest集合并记录Python/工件/服务/供应商配置存在性；输入=B0.1、server/README、server/requirements.txt；范围=只跑测试与只读探测，证据写docs/verification/B0.3/；负例=不输出密钥值、缺服务只影响对应门、不为对齐版本偷改环境；命令见下；完成门=独立复核后done。
- 固定集合：`PAPER2LAB_DATA_DIR=<临时目录> server/.venv/bin/python -m pytest server/tests -q`（全量，含real_docling与test_static_traversal；比CI的`-k "not real_docling"`多2条，139 vs 137）。**实测：139 passed，1 warning，退出0，491s**；warning为asyncio executor线程join超时300秒（test_api健康检查，这也是总时长偏长的来源，待查，不影响本基线结论）。用临时数据目录，未碰server/data。dist为本轮B0.2构建产物。
- Python环境：server/.venv为CPython 3.12.12；关键版本docling 2.131.0、fastapi 0.142.2、agentscope 2.0.9、onnxruntime 1.31.0、rapidocr 3.9.2、pytest-asyncio 1.4.0；完整179行freeze见证据。**漂移（已登记未处理）：pytest 9.1.1超出requirements的<9，pypdfium2 5.13.0超出<5**。CI/Docker按requirements安装，版本与本机不同；README安装命令也未使用requirements。本基线不等于requirements精确版本下通过（归O1用干净环境复验）。
- 解析工件：HF缓存存在docling-project的CodeFormulaV2/docling-layout-heron/docling-models；real_docling测试实跑通过。未单独设离线环境验证。
- 服务：psql 16.14客户端在；~~brew postgresql@16服务状态error、pg_isready无响应~~（**⑱已修复**：根因陈旧postmaster.pid，清除+pg_ctl启动，localhost:5432 accepting——D1.1环境门解除）；redis/valkey未安装；docker CLI在，守护进程未运行（`docker info`连不上）。均只影响D1/J1实际门。
- 供应商配置：env无PAPER2LAB_AGENT_*/DASHSCOPE_*，仓库无.env（只查键名，未读值）。**仅A0.3真实验收受阻，A0.1/.2及A1不受影响**；到A0.3时再按LOOP §3提一次人工问题。
- 限制：Node 25.4.0下跑引擎相关pytest；本基线未覆盖真实供应商。pypdfium2漂移的VLM渲染路径无测试覆盖（139通过不构成5.13的经验验证）。
- **独立复核**：只读reviewer（19次工具调用，实跑--collect-only得139）结论“通过，可签B0.3 done”，两句修正已并入。**状态done。**

### B0.1 执行记录（2026-11-06②，owner：ZCode主会话；状态：done）

开工卡六项沿上方旧卡（行为=导读+校准+基线；范围=只读，仅写STATE；门=独立复核后done）。

**已读范围**（主Agent实读 vs 只读子Agent导读已整合，未静默跳过）：
- 主Agent实读：DEVELOPMENT_PROMPT/AGENTS（新「当前开发入口」节+宪法v6）/PLAN/LOOP全文本；研究README、WHITEPAPER、implementation-review-20261105、codebase-map.md、development-source-map.md、**16章（引擎选型：R3F+Koota主选/PC备选/Godot排除、SPD椭球过闸案例、六模块DESIGN接口）**、**17章（生成式World Program：三权限层、WorldProgramRevision五制品、QuickJS同步step+宿主意图验证、事务=冻结→VM→验意图→科学Job→Run核验→独立Goal→expectedRevision原子提交、三个产品世界、双程序最小切片）**。
- 子Agent①导读（已整合）：02（DSH整体No-Go/受限试点Conditional Go、785行毛候选净删0、jobs-local内存Map）、04（PostgreSQL+内容寻址优先、PaperQA复用预解析、RQ/Valkey真实故障实测、Kakeya引用图OpenAlex/S2空但HTML含bib25/26、session加载单try坏全停agent.py L141-158）、05（全DESIGN、五模块包图、Math IR v0.1受限语法、六实体不共享status、at-least-once+领域幂等）。
- 子Agent②导读（已整合）：06（A桌面P95≈B全屏≈18.2ms但像素区域不同非公平基准、保留桌面=维护成本推断非测量证明、AGENTS写react 19.3而package.json实为^19.2.0）、12（五模块写权表、操作合同taskId/operationId/modelRevisionId/planId/inputsHash/budget、registerPlan同ID异内容不报冲突、RK4无时间入参/无精度证书、loop标志→SOP截流）、13（编译七检查、SceneSpec/SceneBinding、registry.ts:240 kakeya.generate输出与executor.ts:157-172不一致、run3dStore.ts:91-120无generation提交/measure失败仍resolved）、14（八能力World/Entity/Action/Rule/Simulation/Goal/Progression/Replay、事务Run无流式Episode、solveLevel三态）、15（**19断言17过：两项失败=初始scalar Run丢spec.source+formula.evaluate fork丢parentRunId，根因是两处传递口须同时修——executor.ts:1005未把opts传给runFormulaEvaluate、且该函数executor.ts:71-86调用executeSpec未传{parentRunId}（只修1005修不好fork血缘）；runKind漂移formula.evaluate注册formula.curve实产formula.value；独立Python几何核17步搬针解+穷尽21态无解+64条unknown边不冒充unsat**）。
- 子Agent③查证：codebase-map §2 八条链逐条核对源码（下节）。
- 未读且非本子项直接依赖：materials/original-folders完整原研究树（按development-source-map在对应子项查证）、contracts/研究schema（W1/W2时升级）、158页PDF（文件缺失，以Markdown/TeX为准）、01/03/07-11章（01调用链结论已被codebase-map+本次源码查证覆盖；其余非当前直接依赖，后续子项按PLAN §8定位再读）。

**实际调用链核对**（子Agent③逐行验证，全部属实，两处小差异）：
- PDF链✓：Home.tsx:89→uploadFlow.ts:33→upload.ts:65/79/114-166→/api/ingest轮询→routeAdapter（动态import 46-47）→App.onDesk→PaperDesk。**差异a：默认IngestMode='vlm'（Home.tsx:44），默认走VLM而非Docling链**。
- 后端解析✓：main.py:554 _convert_isolated→_WarmIngestWorker(408/441/464-498)→server.ingest_worker:35→ingest_core.convert_pdf:80；VLM main.py:623→vlm_parse.py:200。
- 公式执行✓：PaperDesk.tsx:95-113→analyze.ts:57/spec.ts:35→explorerStore.ts:124(create/127 PlayPlan/133-185 Observable)→executeSkill('formula.plot')(166-177)→Run→shapes.tsx:388/513。
- Agent链✓：agentBridge.ts:85/109→agent.py:1373-1378→orchestrator_stream:1321/agentscope_stream:1007→_server_run_tool_call:1112→bridge agent_steps:1161-1164→engine_server.ts:88-113→agentSteps.ts:150→executeSkill。缺陷点位确认：**global _last_ok_summary在agent.py:1027**（PLAN§7属实）；**工具回执截断json.dumps(out)[:8000]实际在1081行**（PLAN写"1084附近"，差异b=行号精确化）；**关键词SOP截流在1333-1343**（属实）。
- 引擎分支✓：engine_api.py:92 `_ONCE_BUNDLE.exists()`优先engine_once.mjs→否则bridge；engine_bridge.py:66-68 bundle优先→否则tsx。**两制品均存在且git干净（90KB/103KB，mtime 2026-10-29 17:26:59）**：engine_once.mjs最后提交b9375ef，其依赖（executor/registry/playPlan/experiments/physics/challenges及engine_once/engine_persist入口）自b9375ef零改动；engine_server.bundle.mjs最后提交527c0f5，随同提交的src/skills/agentSteps.ts一起重建（engine_server.ts入口本身自b9375ef也零改动）。**“一致”只指git干净+提交历史对应，未做HEAD源码重建比对**（S1改源码后须实际重建并验收）。副作用import：engine_once.ts:10-11、engine_server.ts:26-28。
- 已知缺陷全部在位：executor.ts:1005 `runFormulaEvaluate(input)`未传opts（1006-1014其余均传），且71-86内executeSpec未传{parentRunId}；period0可null在executor.ts:708-717（ode.phase同型476-485）而registry.ts:220声明number；engine_api.py:52/70-76 requestId仅进程内OrderedDict；engine_persist.ts:19-26吞错+仅resolved；main.py:268-290 _restore_jobs仅pending/running→error、queued保留无重建。
- 旧Kakeya/3D✓：DeskCanvas.tsx:107+旧词汇runSkill(136/159)；手工envelope kakeyaGraph.ts:45/72/130；run3dStore.ts:91 commitPacking→kakeya.generate/measure(102-113)；RunView3D.tsx:41/85/135。hash入口✓：main.tsx:13/19。

**现状差异（STATE旧记载 vs 实测）**：
1. 旧称"未见node_modules/server/.venv"→两者均已存在（node_modules .pnpm 386包；server/.venv为Python 3.12.12，含accelerate/docling系依赖，完整清单归B0.3）。
2. paperSpec.ts用户脏文件（docId→paperId+version:1+extractedAt）：消费者仅SpecPanel.tsx+3个测试，**不在引擎once/bundle依赖树**（S1修复executor时无需因它重建制品；但S1改executor后制品必须重建）。
3. AGENTS写react 19.3，package.json实为^19.2.0（06章发现，登记待后续统一，非本子项）。

**环境命令实测**：git rev-parse HEAD=37352d9e…✓（与基线一致）；git status --short= M AGENTS.md/README.md/src/skills/paperSpec.ts + 未跟踪DEVELOPMENT_PROMPT/LOOP/PLAN/STATE/docs/development/docs/research/playable-mathematics…；node v25.4.0；pnpm 10.30.2；系统python3 3.14.2；server/.venv/bin/python 3.12.12（符合server README的3.12要求；依赖清单→B0.3）。

**受保护文件**：src/skills/paperSpec.ts（用户脏改，不动）；AGENTS.md/README.md修改（研究同步产物，保留）；全部未跟踪文档（本轮上下文）。

**本次修改**：仅STATE.md本记录。未改生产代码/锁文件/制品；未读任何密钥值；未运行产品测试（归B0.2）。

**理解登记**（DEVELOPMENT_PROMPT要求的首次理解产物）：三检查点=C1论文研究（真PDF/检索/Qwen工具循环/Run/恢复桌面）→E1生成游戏（同SPD双程序：通闸+盲测）→E2持续使用；五模块写权=Paper Library(版本/锚点/模型修订)·Research Agent(任务/会话/工具调用，不产数值)·Scientific Runtime(参数/PlayPlan/Run)·MathWorld(Host保护态/Goal/Assessment)·Lab UI(布局/引用)；PDF链/Agent链/UI回显链如上核实；已有能力=统一执行器/Registry/PlayPlan/Run协议/VLM解析/AgentScope+Qwen云回合历史；计划缺口=S1科学合同漂移→A1工具端口→A0真回合→D1/P1/J1/L1持久链→C1→W1-3/A3/U2→E1→X1/O1→E2；当前改动入口=STATE+研究文档（未动生产）；验证门=PLAN§4.2定向检查入口+B0.2基线。

**独立复核**：只读reviewer agent_a08c0706（Explore，首轮34次工具调用抽查源码/制品/git log/15章原文）结论“有条件通过”：两项必须修正（15章根因须写两处传递口；bundle“与HEAD一致”过度声称）+386包建议，均由主Agent对照源码核实后修正；增量复核三项PASS、结论“可签B0.1 done”。未解决项：bundle未做HEAD源码重建比对（S1改源码后须实际重建验收）。**状态done，owner继续持有转入B0.2。**

候选顺序（不是ready声明）：B0.1→B0.2→S1.1/.2/.3；B0.3满足Python门后A1.1/.2/.3→A0.1/.2/.3。后续依PLAN依赖推导，不将此顺序复制成另一份状态表。

执行记录字段如下；没有实际运行的数据留“未运行”，不填估算通过：

- task/subtask、owner/chat、开始HEAD与diff身份、failureId、该根因修复次数（0..3）与历史累计次数。
- 用户可见行为/消费产物、输入revision、硬依赖或已done子项、受影响路径、负例与完成门。
- 本次实际修改、命令及退出码、真实输入/结果/限制、证据路径及hash。
- 独立reviewer/结论/未解决项；当前状态；释放owner情况；精确下一动作。
- 若细化工作包依赖：列出已完成产物、允许独立开发的消费者、仍未满足的集成门及理由；不得消除原验收要求。

## 人工问题与阻塞队列

**当前无已查实的待答问题或阻塞。**不为尚未检查的key/数据库提前索要信息。发现问题按下面字段增加一行；同问题不因换对话重复创建。

| questionId / task.subtask | 类别与已查原因/证据 | 精确问题、选项/推荐、默认是否允许 | 受阻范围 / 可继续项 | 回答生效前提 / 恢复触发 | 时间 / 状态 / 处理结果 |
|---|---|---|---|---|---|
| Q-S13-1 / S1.3 | 完成门变更（LOOP §5）。独立复核三轮确认代码必修全过；5项合同归属按推荐裁定 | 裁定来源：会话续行指令逐项采纳推荐（①J1 ②N1+D1 ③D1 ④接受为S1语义+N1收紧 ⑤D1）；**诚实登记：用户未亲自逐项作答，此为运行时续行指令的裁定**——若用户后续明确反对，按LOOP标superseded并回滚PLAN修订 | 曾阻S1.3签收与S1收口；现均解除 | 回答时HEAD=37352d9+本会话修复（制品28d454c1/a7ff191c） | 2026-11-06⑪ / applied / PLAN已修订（S1行+J1/N1/D1行），S1.3据此收口 |
| Q-A03-1 / A0.3 | 凭据（LOOP §3缺凭据行）。B0.3实测：env无PAPER2LAB_AGENT_*/DASHSCOPE_*、仓库无.env | A0.3真实验收需OpenAI兼容供应商凭据（如discovery-api qwen）。请在宿主环境（shell env或部署secrets）配置 PAPER2LAB_AGENT_PROVIDER/…_BASE_URL/…_MODEL/…_API_KEY（历史用discovery-api.intern-ai.org.cn/v1+qwen3.8-27b）；不粘贴明文密钥到对话/仓库。默认：无——A0.3真实验收保持blocked，fixture不签收 | 仅A0.3真实验收受阻；可继续D1.1及后续 | 配置后HEAD须仍≥37352d9+本轮修复 | 2026-11-06⑱ / open / 待配置 |

问题状态：open → answered → applied，或superseded。blocked任务另记录environment/dependency/defect/review原因，没有人工动作就不要伪造questionId。回答收到后先校验revision与权限，再解除阻塞；下游仍要验收。

## 近期记录

- 2026-11-06㉔（P1.3+P1收口）：迁移10（papers.identifier+部分唯一索引）+store_paper_upload identifier分支（同identifier异bytes=同paper两版本并存）+ingest identifier表单字段。6测（去重/版本并存/无identifier不变/crash重试保旧anchor/缺全文诚实原PDF可读）+**真实PDF完整trace**（真docling 54.8s：真版本+region+items+字节全等——real_pdf_trace marker）。复核首轮抓必修#2（跨路径version_id冲突丢上传+identifier丢弃）→修复（Paper作用域version_id+NULL回填）+探针实证→终审通过。**P1父项收口done**。残留随L1（第三identifier吸收）。未commit/push。

- 2026-11-06㉓（P1.2 done）：迁移9步parse_artifacts（append-only）+_anchor_precision_for（docling→region/vlm→page/未知拒猜）+persist_doc追加parse artifact行+GET /papers/{id}/parses（列表）与 /parses/{id}（完整JSON，旧anchor可打开）。7测（重解析两行旧行可开、旧page新region无升级）+全量快集193过（含4旧fixture TRUNCATE必更维护——FK阻断16e+2f先复现后修）。复核七项PASS（append-only/精度/端点探针实证）。未commit/push。

- 2026-11-06㉒（P1.1 done）：GET /api/papers（版本列表+upload来源嵌套；无库诚实空、故障502）+GET /api/papers/{id}/pdf（内容寻址blob服务原PDF——解析运行中/失败/完成均可读；404/410）；db.py两helper（list_papers三表JOIN装配/paper_artifact_sha最新版本）。7测（含hang窗口内pdf 200原字节、crash失败后pdf 200）+全量快集186过。复核六项PASS+**热修D1.3遗留import序缺陷**（_restore_jobs调用先于_get_doc定义→data目录有docId job时import崩——真实data目录探针复现验证修复）。未commit/push。

- 2026-11-06㉑（D1.3+D1收口）：迁移8步documents表+persist_doc DB模式只写PG（无双写、失败repo_error不回落JSON）+_get_doc PG先legacy只读回退+db_export.py导出/恢复演练（6表FK父序、计数相等断言）。5测+全量快集179过。复核"通过"（导出恢复自跑实证）；三建议当场处置（重启恢复改_get_doc修docId丢失/测试4补正向断言/STATE补记export不含imported_*）。**D1父项收口done**：PLAN D1行完成证据全满足，P1/J1解锁。未commit/push。

- 2026-11-06⑳（D1.2 done）：migrate 6/7步（imported_docs/imported_runs落地表）+db_import.py（doc快照与runlog只读导入：原ID保留、provenance=legacy-*、sha256逐源可验、同id同hash幂等skip/异hash conflict不覆写/坏行只丢自己、legacy数字JSONB逐字零重算零新Run）。8测+全量快集174过；**真实快照导入**：11 docs/777行runlog→421导入+356log内同id同内容重复幂等跳过，清表重跑同数、暖跑零新行。复核六项PASS（自跑真实导入逐数吻合+hash独立复算）；建议的conflict正向hash断言当场补。未commit/push。

- 2026-11-06⑲（D1.1 done）：PG环境门解除（陈旧postmaster.pid根因，pg_ctl重启localhost:5432 accepting）；psycopg[binary]3.3.8入venv+requirements。server/db.py（connect/migrate 5步版本化幂等/ensure_workspace/store_paper_upload内容寻址blob+workspace作用域Paper-Version+upload_events留痕/get/artifact_bytes，全字面量SQL+命名参数）+main.py ingest真实消费者往返（env门控、DB失败记repo_error不阻断、无env行为不变、202响应携repo）。红→绿途中修真bug：id派生漏workspace致跨库PK撞车。9测（5库面+4端到端ASGI）+全量快集166过。复核六项PASS（探针实证）+当场修.part唯一名；id碰撞回退转D1.3。未commit/push。

- 2026-11-06⑭（A1.3+A1收口）：R8链修复（turn_state跨轮传baseRunId，制品实测set a=3→链上×2=peak6/对照=peak2，复核者更强b符号例peak18/6）；desk错配改显式error（不再暗改op，桥零调用）；operationId幂等（Python sha256身份+引擎账本回放/冲突）；顺带修真缺陷：formula.plot spec不记完整values（非参数绑定丢失）——model.values快照+inputForRun优先，回归用b符号钉死（复核确认红性）；[:8000]裸截断改_tool_output_json（超限→合法slim，错误批次两级降级均保status/message——复核两轮抓出兜底丢错误语义后一行修）。三轮复核终审通过。**A1父项收口done**（晚回执转J1标注）。pytest 38、vitest 494、制品14f4924c/daa187d3。未commit/push。

- 2026-11-06⑬（A1.2 done）：操作账本（workspace|operationId|idempotencyKey；payload=canonical digest(skill,input)；同键同payload回放零重执行、失败同样缓存、同键异payload operation_conflict拒、未知工具/needs_input/unsupported不烧operationId、回放剥离首调invocationId）+engine tool_execute接操作身份。复核"有条件通过"→两项必修处置（needs_input不缓存+清id，测试op-8/op-9钉死）→终审通过（441a647e制品实测）。18+493全过、pytest 20过、server.bundle第八建。边界如实：进程内/FIFO驱逐重执行/无operationId旁路归J1。A1.3开工卡备好（R8 base链/R10截流/暗改op锚点读齐）。

- 2026-11-06⑪（S1收口+A1.1实现）：会话续行指令逐项采纳推荐裁定Q-S13-1（①J1②N1+D1③D1④S1语义+N1收紧⑤D1；**诚实登记：用户未亲自逐项作答，此为运行时续行指令裁定，用户后续反对则superseded+回滚PLAN**）；PLAN四行修订（S1行改写+J1/N1/D1各增移入项）。S1.3、S1（父项集成门：19断言+全量475+render-webgl+pytest28+once实测，全在终态代码/制品上）收口done。A1.1红测先行实现：toolPort.ts（目录+回执，无第二执行器）+engine tools/tool_execute两op，9+全量484过、bridge制品实测（含篡改输入经端口仍被计划门拒）。制品：server.bundle=a58a3f54（第六建）、once.mjs=28d454c1未变。未commit/push。

- 2026-11-06⑩（S1.2签收+S1.3挂问题+A1.1开工）：S1.2经三轮独立复核终审"可签done"（M1导入原子性/M2嵌套分类/记录残留全修复；475测试、render-webgl复跑PASS、制品五建28d454c1/a7ff191c）。S1.3代码必修全过（点号伪造绕过已封并经制品实测、ode.phase入FORMAL门、fork加hasPlanCovering门），但复核明示5项合同归属需用户裁定——已按LOOP §3以Q-S13-1一次性提问（预算归属/异源-parent-版本/fork核对深度/空种子语义/once跨请求，各附推荐），用户暂未回答，S1.3保持blocked-human。等待期间按PLAN §4.2开A1.1（工具端口，不消费S1.3产物）。制品与源码终值hash见S1.3节。本轮全程未commit/push。

- 2026-11-06②（B0.1执行）：主Agent实读PLAN/LOOP/研究README/WHITEPAPER/implementation-review/codebase-map/development-source-map/16/17章，三个只读子Agent导读02/04/05/06/12/13/14/15并逐行查证codebase-map八条调用链——全部属实，两处小差异（默认IngestMode='vlm'；agent.py截断精确在1081行）。环境实测：HEAD一致、node v25.4.0/pnpm 10.30.2、**node_modules与server/.venv均已存在（推翻旧记载）**；engine_once.mjs/engine_server.bundle.mjs存在且git干净（once依赖树自b9375ef零改动，server bundle在527c0f5随agentSteps重建；未做重建比对）；PLAN§7缺陷点位（executor.ts:1005/period0 null/agent.py:1027/1081/1333-1343/engine_api requestId/engine_persist best-effort/_restore_jobs）逐一确认在位。仅写STATE，未动生产/锁/制品。B0.1状态verifying待独立复核；复核过→B0.2。

- 2026-11-06（修复Agent找不到启动文件）：定位为worktree可见性问题：0c04有未跟踪prompt/计划/研究，桌面主项目没有。现将开发文档及完整研究11929文件条目补到桌面主项目，目标已有AGENTS/README修改前确认与HEAD一致并备份，未同步生产源码；用户paperSpec.ts脏改动hash前后一致。新增verify_agent_context.py，两个根目录54/54必读文件UTF8读取通过；ZCode指南改指桌面主项目并解释本地/历史/远程边界。没有commit/push/产品运行，独立复核见docs/development/context-repair-20261106。

- 2026-11-05（研究与代码理解前置）：两路只读Agent梳理实际前后端，新增docs/development/codebase-map.md，标清双画布/双Skill词汇、Observable/Reactive边界、HTTP once与Agent bridge/bundle执行分支、生成物/资产/CI消费者及整理归属。DEVELOPMENT_PROMPT扩为先读研究正文和02/04/05/06/12–17合同，再读地图并实核源码；B0.1登记理解与差异，后续S1/A1/U1/J1/O1按消费者整理。PLAN/LOOP/AGENTS/入口与ZCode指南同步。/root/map_code_frontend独立复核合成地图/启动合同通过，54个本地入口链接与21包63步DAG、git diff --check通过；本轮仅文档，未搬删生产/安装/运行产品。身份见docs/development/codebase-map-verification.json。

- 2026-11-05（开发loop启动交付）：新增根目录DEVELOPMENT_PROMPT.md及docs/development/zcode-loop.md，覆盖整产品启动、真实工具使用、最多三个只读子Agent、独立review、最小阻塞/恢复与权限边界；AGENTS/LOOP/README接入口。本机实际zcode --version为0.17.1，--help退出0，已核对官方CLI/权限/子Agent文档；未启动模型任务或改全局配置。/root/review_launch_prompt独立静态审阅通过，34个当前入口本地链接与git diff --check通过，身份见docs/development/zcode-launch-verification.json。仍无产品实现/新Run，交付prompt不代表已开始B0。

- 2026-11-05（按用户纠正完整搬迁）：上一轮筛选副本不满足完整搬迁，本轮将3个原研究附件目录、3个原临时研究目录和3个用户请求附件目录实际整树移入materials/original-folders，10597文件/11874entries/270387962字节，含隐藏文件与.git，无排除；另迁1个辅助脚本，旧9目录及脚本路径均消失。原历史副本/tar不删除，旧PDF与已不存在环境仍标缺失。独立/root/audit_full_migration全树hash/type/mode校验通过；/root/audit_delivery_execution复查全产品，补N1.2/C1.1原文转写忠实性负例，B0.2补上游测试与本项目测试收集隔离，独立增量复核通过。21包63步DAG无环，83个当前入口本地链接无缺失，git diff --check退出0；未改生产/安装/模型请求或产品Run。下一动作B0.1，不再泛扩研究。

- 2026-11-05（材料归档与设计复审）：仍可找到的外部研究材料归入研究materials/，983个副本、2个源码压缩包，原件保留；不纳入.git/依赖安装目录，缺失PDF及旧临时环境单独登记。三个只读分支提出10项问题，修订原子Goal提交/服务端权威行为与离线边界/盲测信息可解性/二进制证据/PDF模型链/工具宪法/引擎所有权/目标Run绑定/批次恢复/SOP截流，未修改生产代码。最终独立reviewer /root/final_design_review复核通过，并纠正W3新VM隐含依赖及N1候选职责倒置。实际校验退出0：归档hash/大小/结构零错误、21包63步DAG、审查文件hash、76个当前入口与修改文档本地链接、git diff --check。没有安装、模型请求、服务运行或新增产品Run；下一步仍为B0.1。

## 本次计划校验身份

- PLAN.md sha256：5b19bbf309aae17f214554f4cca5dcded9cd78521196ae9bfae2e80e2ffaf026。
- LOOP.md sha256：c072a59991b23f0a9c464e70aa93bf32baf78678c9357f0fd1733daef65fc07a。
- git diff对src/server/scripts/package/锁文件/Dockerfile无变更；本次仅修计划/状态/白皮书/入口与研究归档；独立复核绑定上述文件身份及审查JSON，不能沿用到后续代码修改。没有产品运行验收。

## 清理候选

- .playwright-mcp/已忽略、约16KB，收益低；不清理用户运行状态。
- 研究已包含完整原目录、历史压缩快照与失败账本，按任务读，不批删；历史记录中的PDF为11月2日快照，当前文件缺失，未重建；以现存Markdown与后续修订阅读，不冒充已读PDF或当前实施规范。
- xyflow/tldraw各有现存消费者；未发现经引用检查与回归证明可删的生产路径。
- README旧测试计数已移除；后续随真实替换登记可删路径/替代者/引用检查/review/回归结果，不开无边界清理工程。
