# Paper2Lab 集成恢复点

2026-11-06。Linear导入及86项逐条回读通过；**任务进度、认领、阻塞和依赖的唯一权威已切换到[Paper2Lab](https://linear.app/clion/project/paper2lab-fb8690d9daff)**。本文件只留恢复点，不维护第二份完整任务表。历史导入源状态见[快照](docs/verification/linear-20261106/source-STATE.md)，它不是当前进度。

## 当前owner和恢复动作

- 唯一生产/集成owner：原ZCode主会话（sess_ae02bc73-c896-40c0-816f-6e4136fa743f），桌面主目录唯一写者。HEAD仍为37352d9e09f2e2c5f63017b3cfffc33471e708e0；大量实现/研究/计划未提交（无commit授权），不能从旧HEAD启动依赖开发，也因此暂不开并行worktree（需用户授权的checkpoint commit形成完整基线）。
- 已完成：[CLI-100 / J1.1](https://linear.app/clion/issue/CLI-100/j11-持久执行与恢复用一个真实解析任务落taskattemptoutbox实际worker消费queued状态可重启重建先不上全部队列) 2026-11-06由原owner按legacy解析范围签Done并回读（三轮独立复核，第3轮通过无必修；同一冻结身份集成复验15/213/真docling 57s）。代码身份与携带项见[CLOSEOUT](docs/verification/J1.1/CLOSEOUT.md)。
- 当前任务：[CLI-144 / J1.CI](https://linear.app/clion/issue/CLI-144/j1ci-数据库队列测试隔离与ci必需服务)（集成者在主目录单写者执行；开工卡写入issue后开始），之后[CLI-145 / J1.2a](https://linear.app/clion/issue/CLI-145/j12a-node科学worker和原子run提交)→[CLI-146 / J1.2b](https://linear.app/clion/issue/CLI-146/j12b-dsh官方ts-sdk接同一科学端口)，须实际满足依赖/路径/资源门。
- C1/E1/E2均未验收；旧B0/S1/A1/D1/P1及A0.1/.2的Done仅保留原消费者范围，不代表新DSH/Node/TS解析已完成。
- 本会话无worktree/提交/推送。共享PG(paper2lab_d11_test)/Redis DB15破坏性测试仅本集成窗口串行跑（含其只读复核子Agent，经串行化），J1.CI隔离前其他窗口不得运行。

## 工具与问题

- Codex Linear已真读写P-CLI-3并逐项核对父子关系/状态/依赖；[身份映射](docs/development/linear-map.json)不是实时状态缓存。所有新窗口先get实际issue，更新后回读；普通issue更新不是原子认领锁。
- ZCode连接已在本会话验证（2026-11-06）：get_project(P-CLI-3)/get_issue/list_issue_statuses读取，save_issue+save_comment写入CLI-100，get_issue回读一致。
- Q-A03-1：[CLI-93 / A0.3](https://linear.app/clion/issue/CLI-93/a03-早期真实agent回合额外依赖已集成j12b的dsh工具适配不要求整个j1完成经dsh官方ts)带blocked-human标签；供应商配置/真实回合尚未验，另依赖J1.2b。仅查凭据存在性，不索要明文，不以配置存在就签ready。
- Q-LINEAR-1已解决：读取、写入和回读成功。将来失联按LOOP由唯一协调者留离线检查点、冻结新分派；不能每窗口重建私有tracker。

## 启动与证据

读AGENTS→当前issue→LOOP/PLAN当前合同；运行node docs/development/verify_agent_context.mjs --root .只验文件可读性。不同worktree/远程Agent不自动获得本地未提交文件，不能互用证据。

完整可粘贴目标/I协调/C工作者/R审核及工具规则见[WINDOW_PROMPTS](docs/development/WINDOW_PROMPTS.md)；[COORDINATION](docs/development/COORDINATION.md)规定写权、基线和集成。

## 最近记录（最多5条）

- J1.1收口（ZCode集成者）：第3轮增量复核通过（真实RQ 60s窗口复现：旧代码崩溃丢任务、新代码跳过坏记录并在下次启动补回）；同身份集成复验后CLI-100签Done并回读；三项非阻断携带项与快照两处文字不精确记于CLOSEOUT，快照不改写。
- 本轮Linear：复用P-CLI-3，保留原22条历史任务；新增21父/65子，逐项远端readback86/86无错，关系与源合同一致；不重跑旧验收、不代签J1.1。
- 本轮prompt：按真实CLI-100/144/145/146/93分角色；补宿主工具发现/连接不共享、复用优先、只读审核与禁止自行领下一项。
- 前轮规范：DSH/Node主线合并，12份过时提案/重复检查器清理；原记录见docs/history和docs/verification/loop-20261106，不转移旧review为新运行证明。

- 本轮提速：M1–M4里程碑已建立；CLI-145移除CI144整项阻塞，CLI-102纯provider移除J1父项阻塞，CLI-105模型分道。CLI-100已Done，根约束不再要求无变化复审。完整映射/依赖以Linear为准，不用本段历史描述重新排队。
