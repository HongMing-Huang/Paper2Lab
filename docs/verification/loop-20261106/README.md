# 开发规范与多窗口审查结果

2026-11-06。本批规范经两个独立只读reviewer查出冲突后修订，终审通过。签收范围是开发文档、任务依赖与清理；不是J1.1或C1/E1产品验收。

当前正式入口是桌面根AGENTS/LOOP/PLAN/STATE/DEVELOPMENT_PROMPT，0c04根AGENTS已指向此处，避免旧研究进度覆盖活跃实现。完整协议见[多窗口合同](../../development/COORDINATION.md)。

本次已合并DSH官方TS SDK与Node路线，保留既有legacy解析、SQL、工具端口和科学内核的真实完成范围。J1.1仍由原owner终态复验/review；接续J1.CI→J1.2a科学执行→J1.2b DSH，A0.3同时要求凭据和J1.2b。默认阅读不再要求完整白皮书；历史根全文和失败证据按需查。

删除12份已合并提案/重复检查器，215122字节，替代路径与hash在[清理清单](../../history/20261106-before-loop-unification/cleanup-manifest.json)；没有删除生产代码、执行bundle、数据或原论文研究。Node可读性58/58、活跃链接无缺失、21父项/65切片依赖无环。只执行文档检查，没有重跑产品/共享数据库测试。

**Linear未完成**：项目/团队读取返回需重新认证，已请求用户重连，零issue创建。[待导入数据](../../development/linear-plan.json)不是已建任务或实时tracker。重连后必须先查重/映射实际团队和状态，再创建/更新和回读；没有后台自动导入承诺。当前STATE仍是临时权威，其他窗口只读；完整基线、任务分派和资源隔离后才能多worktree写开发。

真实检查、独立review身份、文件hash与官方来源见[audit.json](audit.json)。任何后续代码/STATE更新不继承本批运行或签收身份。
