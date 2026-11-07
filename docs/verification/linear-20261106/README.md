# Linear落地与窗口prompt核验

2026-11-06。复用P-CLI-3和原22条历史任务；真实新增21父/65子，86项均逐条get回读，身份/标题/状态/parent/blockedBy零差异。实际map在docs/development/linear-map.json，回读快照在readback.json；它们不是实时进度数据库。

Linear已成为可变任务权威，STATE只集成恢复点；导入源PLAN/STATE在本目录source-*，用于解释原legacy Done范围，不作为当前约束。J1.1仍In Review由原ZCode持有；A0.3带blocked-human且依赖J1.2b。本次没有运行产品、签收J1、创建worktree或验证ZCode客户端连接。

目标和I原协调者/C CI候选/R只读reviewer的完整可粘贴prompt、实际工具顺序与复用边界见docs/development/WINDOW_PROMPTS.md，也保存到同一Linear项目document。独立只读review通过四处修订及最后路径措辞；reviewer只核本地与保存证据，没有独立查询远端，不代签产品能力。

文件身份、真实ID和文档URL见audit.json。后续任务必须实时读Linear，不拿本目录快照当当前owner/状态。
