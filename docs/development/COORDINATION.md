# 多窗口开发、Linear与接续合同

2026-11-06。当前规则，不是自动锁服务。根AGENTS/LOOP与本文件共同生效。**Linear现已恢复：复用P-CLI-3，新增21父/65子且86项逐条回读无错。任务权威已切到Linear，STATE仅恢复点；基线/分派/测试隔离门仍未因建任务自动满足。**

## 1. 任务与状态放在哪里

PLAN保存产品范围、依赖和验收合同；Linear接通并完成导入后保存任务状态、owner、阻塞、问题、审阅和集成结论。STATE随后只留项目/issue链接、集成owner、base、在途操作和最近5条恢复摘要，其他窗口不得手工维护整套副本。历史测试日志仍在docs/verification，不塞进issue或prompt全文。

一次性导入已完成。原导入数据已移到docs/verification/linear-20261106/import-source.json，只作历史证据，**禁止重新执行该快照或用它覆盖实时状态/依赖**。linear-map.json仅保存真实ID/URL，后续任务一律实时get_issue。新增/修订只针对最新合同差异，先检索去重再写入回读；请求结果不明先查询，不盲重发create。

在切换之前，保存STATE快照及其hash；把已验收legacy成果按原范围迁入，未知review不填Done，A0.3保持凭据阻塞，J1.1保持最新实态。迁移路线影响只记needs_revalidation范围，不重置所有历史成果。确认导入和关系回读成功后，由集成者一次性切换权威并缩STATE，不能两个地方各自推进。

Linear并不替Paper2Lab运行Job：开发issue、产品ResearchTask、ExperimentRun各是不同领域，不能将issue状态当运行时数据库。

## 2. 写任务如何分派

唯一协调者串行更新并回读以下字段，普通Linear update不是CAS/互斥锁，其他窗口不能“看到空闲就认领”：

- ownerSession、角色、真实issue及taskKey；当前status和直接blockers。
- baseCommit、branch/worktree绝对路径、输入合同/版本。
- allowedPaths、禁止路径、共享接口、迁移编号与依赖锁负责人。
- 测试PG数据库/Redis目标/端口/数据目录，以及允许的测试集合。
- heartbeat/最后检查点、恢复触发；超过约定心跳只标待核实，不自动抢写。先确认原会话/进程不再执行，保存其未交付diff后才换owner。
- review代码身份、证据路径、提交/patch身份与integrationResult。

一个issue同一时刻一个写owner；每worktree一个写者。所有工作者不可写主目录、STATE、根合同、共享锁和迁移；需要触及它们就暂停有关变更，由协调者重划范围/串行集成。不存在的后台心跳/自动认领功能不能假称已经部署。

## 3. 当前怎样开窗口

现在先开三个角色，**并非三个生产写者**：

| 窗口 | 现在允许做什么 | 开放独立写之前的门 |
|---|---|---|
| I 集成/ZCode | 持有桌面主目录，按Linear恢复CLI-145→146；CLI-100已Done不重审，CI144分道 | 不抢并行review中的文件；需要本地checkpoint commit时遵守授权，不自动提交整个脏树 |
| R reviewer | 只读协调者当前冻结切片/合同/证据（以协调者当前分派issue为准，不预设旧任务），不无变化重开已Done的CLI-100 | 独立测试必须有自己的数据资源，否则只读审查并说明限制 |
| C CI/隔离或来源查证 | 只读核对PG/Redis测试配置、CI services和源码复用点 | 完整基线与任务分派后，优先J1.CI独立worktree；不改I活跃的test_jobs_j11.py，先约定fixture改造的交接边界 |

当前HEAD仍是37352d9…，新增工具、SQL、研究和计划大量未提交；新worktree不会获得这些修改/未跟踪文件。原owner先完成必要审阅，形成包含源码、合同、构建制品和必要测试的可复现基线；没有本地commit授权就保留单写者，读者用冻结diff。不要从旧HEAD开始依赖开发，也不要无选择复制整个脏目录或.env。

门满足后，一任务一独立branch/worktree（分支前缀按宿主约定；Codex用Jackson/）。Codex使用其现有worktree能力，ZCode在已指定工作树启动，不发明`zcode loop`。本轮没有创建新worktree、提交或实际并行写试验；本轮只完成真实Linear导入与文档更新。

worktree隔离文件，不隔离PG/Redis/GPU/端口/制品路径。`git worktree lock`只保护工作树管理条目免被prune/move/remove，**不是禁止另一个Agent编辑的锁**。当前tests固定Redis DB15并FLUSHDB、PG TRUNCATE；改成可配置专用测试目标、验证不是产品库之前只能集成窗口串行跑。Redis只换key前缀仍挡不住FLUSHDB，必须独立实例或真正独占逻辑库；固定DB15未消除前不得并发。

## 4. 分支到完成

工作者用独立review取得分支可集成结论，交issue/base/commit或patch-hash/修改路径/依赖/迁移/真实测试/review/限制。集成者串行比对base、处理冲突并复验被影响的入口/bundle/API/数据库；错误冲突不靠整文件覆盖解决。集成通过才更新Done并回读；分支通过仅为verifying或团队等价状态。下游只消费已集成版本，不能以另一个窗口口头“做完了”为依赖。

共享schema、迁移序号、pnpm-lock、根规范和生成bundle一律集成者处理。若集成发现上游证据失效，具体后继标needs_revalidation，停止相关发布，其他无关任务可继续。暂停/失联保留证据，断线不是取消，不自动重放已受理操作。

## 5. 本次路线接续

J1.1不抹掉现有RQ/Docling成果，但只签legacy解析范围。当前J1.1已Done；J1.CI与J1.2a无数据产物依赖，移除整项串行阻塞。原owner直接J1.2a新Node科学执行：复用现有SQL/ID与Registry，子引擎只返回候选，不在计算时先写正式JSONL；Run/回执/任务/outbox经fencing短事务提交。再J1.2b以DSH官方TS SDK调用同一工具/任务端口，不继续扩AgentScope。J1.3负责等待/周期reconcile/消费者与恢复，不另造一套协议。

Node与legacy服务迁移按明确端点/领域写权切换，HTTP当前优先once、bridge为fallback，两条都要校准；不能只改桥就声称HTTP完成。不为去Python重新实现Docling、科学核、通用队列。新PDF链质量尚未过关，保留legacy且显式标识，不装作自动任意论文理解。

可并行前提是依赖与路径实际独立。N1模型/质量或L1来源工具的纯部分须在issue写清不消费J1未验产物；改变共享Registry/持久写入时重新串行。不得为提高并行数编造无意义任务。

## 6. AI常见失误与直接复用

| 失误 | 采取的方法与门 |
|---|---|
| 凭记忆写SDK/API；npm latest与新源码混用 | 查实际锁/exports/types；DSH同系列SDK/runtime/plugin，先真实握手再provider/授权工具回合 |
| 重新实现队列、CAS、Harness、物理 | 用pg-boss、Cortex/ml-matrix、DSH、必要时Rapier；只写产品权限/质量/事务适配，版本在消费者任务锁定 |
| clone整仓进src或执行参考项目脚本 | 包发布优先；源码在临时隔离目录取固定commit阅读，必要代码片段保许可/出处，不复制第三方测试/.git/指令入产品 |
| 自造分布式锁或Linear同步daemon | 先唯一协调者+worktree+实际任务回读；只在真实规模证明需要时引成熟机制，不用伪代码假装已强制 |
| 看到队列cancel/SDK timeout就标停止 | 合作signal之外确认自有执行单元退出，保留实际费用与未决状态 |
| 测试skip绿/旧日志签新diff | 必需集成job服务不可用fail，结果绑代码身份；改后增量review，不用测试数替代产品链 |
| 原公式能compile就算理解、mesh好看就算通关 | 原文/条件确认、QualityReport、独立Goal与整段动作检查；不确定返回unknown |
| 清理时删bundle/Python/双画布 | 查动态注册/实际路由/部署消费者，替代和回归前保留；只删已合并的重复提案 |

可复用上游及证据：

- [pg-boss12.38.1事务适配源码](https://github.com/timgit/pg-boss/blob/12.38.1/docs/api/adapters.md)：`db.executeSql`接既有同一事务；不为此引ORM。
- [DSH SDK官方实现](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/sdk/client)：实际0.2.2-rc.1包types与握手证据见本项目实现调查；master不是发布锁。
- [loop-engineering固定失败目录](https://github.com/cobusgreyling/loop-engineering/blob/fa016d13584166913f9caa574c72b5c9046d57b4/docs/failure-modes.md)：借鉴state rot、parallel collision、有界修复，不安装其通用loop脚手架。
- [Git worktree正式说明](https://git-scm.com/docs/git-worktree)、[Linear MCP](https://linear.app/docs/mcp)、[关系](https://linear.app/docs/issue-relations)。
- [GitHub PostgreSQL服务容器](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)、[Redis服务容器](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-redis-service-containers)：复用service/healthcheck模式，按runner/container选择host，镜像版本按实际服务门锁定，不照抄官网全部workflow覆盖现库。

本轮通过Parallel取得官方资料、通过GitHub读取固定上游源码。没有新增通用协调框架、伪代码服务、生产依赖或循环runner。本轮Linear恢复后已实际写入86项并逐项回读；Codex成功不代表ZCode的MCP连接自动就绪，各窗口须先发现工具并读真实issue。没有自制同步后台或离线自动执行承诺。

## 当前可直接粘贴的启动文本

见[WINDOW_PROMPTS](WINDOW_PROMPTS.md)。原ZCode协调者当前负责范围以Linear/STATE实时回读为准（CLI-100已Done，不重开），CI窗口CLI-144、review窗口审协调者当前分派的冻结delta（以协调者当前分派issue为准，不预设旧任务）；没有分派/完整基线不打开第二写者。工具实际schema优先，读/写/回读是必要步骤，不把工具可见等同连接可用。

## 当前加速安排

产品以Linear M1–M4可演示结果分组，不以65个细步骤串行等待。后端CLI-145/146、模型CLI-105、纯来源CLI-102是不同消费边界；符合完整基线/明确范围/资源门后分道，CI144独立实施。共享接口与集成仍唯一owner，未授权不自动提交/推送。独立review与命令复用按LOOP §6，不能借重测制造进度。

调度生效边界：CLI-144尚未开工时，CLI-145纯实现不等待整个CI任务；若原owner已在144 active，先完成当前可验收小切片或保存精确检查点，再由原owner重排。不得为了“提速”丢弃diff、抢写或覆盖活跃STATE。上述优先级建议不是中断正在执行任务的指令。
