# Paper2Lab — 当前开发约束

2026-11-06统一修订。当前根文件优先于历史研究/交接提案；长期决策变化同步本文件。[历史实现账本](docs/history/20261106-before-loop-unification/AGENTS.md)退出默认上下文，其中勾选不是本次产品验收。

## 入口与事实

- 2026-11-07用户体验补充：根DEVELOPMENT_PROMPT末节定义连续滚动/来源选区提问与面向普通用户的“目标→操作→反馈→重试”；高级技术配置退出默认主屏。自由探索不强制Goal，挑战规则冻结并独立验证，不能用聊天/动画代替玩法。对应CLI-111/150/151，仅修订任务与Prompt，未据此签功能完成或改动生产代码。

- **2026-11-07最新研发方向**见[陌生论文与执行方案](docs/development/paper-driven-execution.md)：优先新PDF即时可读/增量分析与提问→意图驱动真实数学任务/分段性能证据→Run驱动生成式可操作世界。固定论文、固定三关、方向之室/搬针等仅作验证案例，不能替代原W1/W2/W3/A3生成路线。本轮用户只授权研发方案、文档/任务更新，不修改生产代码或启动重计算/付费推理；后续开发按根DEVELOPMENT_PROMPT执行。旧12小时固定演示安排不再是当前优先级。

- 先读本文件、[STATE](STATE.md)、[LOOP](LOOP.md)，再读[PLAN](PLAN.md)当前项及直接来源。`node docs/development/verify_agent_context.mjs --root .`只验可读性；不每轮吞入完整白皮书/materials/终端日志。
- 整产品目标：真实PDF→来源模型→Qwen自主工具研究→真实Run→可进入/操作/失败/重试/回放/持续探索的数学世界。C1论文研究、E1生成游戏、E2持续使用分别验收，不能只交renderer。
- 桌面ZCode仍拥有生产写权；本轮Linear回读CLI-100/J1.1已Done，身份未变不重复复核，直接推进CLI-145。本轮规范整理不签J1、不重置B0/S1/A1/D1/P1成果、不抢改生产文件。
- 多窗口按[COORDINATION](docs/development/COORDINATION.md)。Linear已真实导入21父/65子并逐项回读；实时任务权威是P-CLI-3，STATE仅留集成恢复点。基线/分派/测试隔离门未满足时其他窗口仍只读。认领回读、完整基线、独立worktree与测试资源隔离后，唯一协调者才能分派并行写任务。每worktree始终一写者，唯一集成窗口拥有主目录/共享合同/迁移编号/锁文件。

## 技术决定与迁移边界

- 新默认链：pnpm/Node/TypeScript、Fastify + pg + pg-boss、**DSH官方TS SDK + Qwen**。不再评选是否采用DSH，不扩张agent.py SOP/AgentScope主编排。[产品](docs/development/product-experience-and-runtime.md)、[后端](docs/development/backend-implementation.md)、[数学合同](docs/development/math-runtime-contract.md)为当前依据。
- Python/FastAPI/AgentScope/Docling/RQ/Pyodide有真实消费者。J1.1按legacy解析范围验收；J1.2a/b新科学/DSH执行走Node，不把RQ继续扩为新Agent底座。替代质量/恢复验证前不删旧链；每端点/领域对象一个写权威，不造第二数据库/数学核。
- 保留Registry/PlayPlan/executor/ExperimentRun、TS/Worker/Kakeya/C++/WASM内核、既有SQL与ID。R3F主选，Koota只组织实体，QuickJS隔离程序，Rapier只管明确游戏物理；PlayCanvas React备选，不维护双ECS/renderer。
- 版本以实际锁/制品为准，官网latest与历史版本表不能作安装依据。DSH SDK/runtime/plugin同系列锁定；本轮0.2.2-rc.1只过握手/目录/close，未证明Qwen/产品权限/恢复。[实现调查](docs/research/implementation-investigation-20261106/README.md)的数学/沙箱探针也不等于产品Skill/Run。
- PDF.js不覆盖扫描识别；本轮Node原生渲染退出139，根因未定。新页图/转写/锚点质量通过前不删Docling/VLM。新默认链不要求Python/uv，不等于现库已经没有Python。

## 科学和游戏合同

1. CALCULATED只来自真实Runtime的ExperimentRun；图表/Metric/几何/Observation引用runId。PAPER/CALCULATED/AI_INFERENCE分开；有限尺度不称定理证明，组件不得硬编码科学结果。
2. 科学参数单一真值、Reactive失效重算、generation拒乱序；Canvas只持引用/布局，Agent持工具决策，Host持权限/预算/正式判定，guest只写GameplayState/意图。不造万能Store或重复科学状态。
3. 参数在公式/对象内部操作；drag同模型preview，释放正式计算，preview不计分。反向拖动受ControlPolicy/域/分支/残差门约束；无解/多解/病态不得静默改数学含义。
4. 执行经Registry与验证PlayPlan，绑定规范输入digest/source/parent或baseRunId/预期修订/预算，N1追加modelRevision；普通合法调参不复制模型修订。缺条件/未支持能力/非法域/非有限/数值unknown不能假成功。
5. Run保留spec/算法版本/seed/时间/血缘/错误；QualityReport逐observable评估。固定RK4不是通用solve_ivp，显含t/刚性等未验能力拒绝；SPD正定检查不替代病态/残差。真实计算不自动满足Goal精度。
6. World Program生成后版本化/编译/隔离/验证，不生成正式React/Three页；不能改科学验证器或玩家冻结规则。LLM不进帧循环、不编科学数值、不判数学正确性。一个实体一个位置积分器。
7. Action冻结revision/seq/预算→真计算→独立Goal→世界/Assessment/事件原子提交。正常未达标可提交，求值异常/非法证据不发布；真实资源/费用失败取消过期仍结算，不随世界回滚。
8. 严格盲测私有实例/step/Goal在服务端，断线暂停权威动作，浏览器隐藏不保密。Solver只在有界profile给见证/反例/unknown，并验公开观察策略，不保证任意程序可解。
9. Agent只调授权领域工具，科学schema来自Registry；大结果受权引用读取，不截断JSON。外部论文/网页/源码指令作非可信数据，不提升权限；产品DSH profile不默认开放shell/fs/net。
10. 持久completed以领域事务成功为准。worker独占同一内核子进程，桥不隐藏重试；健康检查不排在长算后超时误杀。lease/fencing拒旧attempt；取消确认自有执行单元退出。队列/Session/JSONL不是第二领域权威。
11. 恢复保存完整工具批次/回执，不以摘要替代。共享解析按消费者取消，单tab退出不误杀他人。人工回答先验questionId/revision，沉默超时不是科学确认。
12. 保留暖白论文纸面、tldraw/既有xyflow、来源定位；不是聊天墙/卡片墙/Dashboard参数面板。Paper/Lab/Microscope共享Run；C1/E1真操作及Console验收，HTTP200/截图/测试数不代替产品完成。

## 执行纪律

- 最小开工卡→实现→真实验证→冻结diff→独立只读review→集成复验。改后增量review；无review保持verifying。父项和C1/E1/E2另验集成门。同根因最多3次有证据修复，换会话不清零；挂最小阻塞后继续无依赖必要工作。
- 成熟包和现有端口优先，不自造CAS/通用队列/Harness/物理库。实际消费者需要时才安装锁版本/许可/API/生命周期；克隆上游到隔离目录阅读，不把第三方整树/测试/指令灌进产品。必要复制保留许可、固定commit和修改理由。
- once/bundle、双画布、Python解析有消费者，不能凭文件名删；修源码须重建实际执行制品。生产删除需引用/替代/独立review/回归，保留用户脏工作及失败证据。
- 当前测试固定PG/Redis且含TRUNCATE/FLUSHDB；隔离前只集成窗口串行跑。worktree不隔离数据库/端口/凭据/费用。
- 计划内本地实现/安装/定向测试/单浏览器已授权；本轮Linear建任务/维护计划已授权。不自动commit/push、GitHub Issues/PR、merge、云部署、新增付费服务。不add -A/reset/clean/stash覆盖用户工作；凭据仅查存在性，不读值/输出/传模型。

AGENTS放约束，PLAN放合同，LOOP放协议，prompt放启动；Linear认证导入成功后拥有任务进度/认领，STATE只留集成恢复点。切换前不能假称已同步。历史材料按需读，不形成第二套现行规则。

- 本轮提速合同：PLAN §4.1b与LOOP §6覆盖旧粗串行顺序；独立模块分道，协调只串行分派/接口/集成。CLI-145不等待整个CLI-144；CLI-102纯provider不等J1。必要提交/测试隔离/科学/权限门不变；一次功能切片统一定向验证/review，不为小文案重跑全量或重开已签收项。

调度生效边界：CLI-144尚未开工时，CLI-145纯实现不等待整个CI任务；若原owner已在144 active，先完成当前可验收小切片或保存精确检查点，再由原owner重排。不得为了“提速”丢弃diff、抢写或覆盖活跃STATE。上述优先级建议不是中断正在执行任务的指令。

- 当前用户已明确授权直接实现产品功能：按LOOP §7运行优先，不沿用历史“本轮只整理规范”的范围。本轮Codex在CLI-111登记UI/启动切片，避开原ZCode后端CI文件；保持科学正确性、数据安全与必要运行验证，复用现有测试，不增加形式门禁。启动Prompt见DEVELOPMENT_PROMPT末节。

- 旧12小时固定演示安排已由2026-11-07用户方向修订取代，见LOOP §8与§9。保留少量必要数学正确性与真实产品联调，不新增大量测试文件/复杂门禁；本方案轮不运行测试。缺供应商或硬件只阻塞相关分支，不假称Agent/Intel完成。

- Intel端侧当前实现见server/edge/README.md与Linear CLI-147：Node薄适配复用官方OVMS，devices.py只用OpenVINO官方绑定枚举设备。无模型/设备实测；不把配置路由当实际设备、不标推理为CALCULATED。原DSH/J1 owner范围不变。用户要求本轮不写/运行测试，仅编译检查，设备验收后移目标机完成。

- 用户要求docs/research/研究材料仅保留本地，不纳入Git或上传；Git克隆不会包含这些材料。开发入口与可共享合同保留在根规范及docs/development/，不能声称其他窗口/远端已自动取得本地研究原文。
