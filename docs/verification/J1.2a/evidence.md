# J1.2a（CLI-145）实现验证记录 — 2026-11-06

owner：ZCode 新主会话（本会话）。base：桌面主目录 HEAD 37352d9 + 未提交工作树；交付以 after-sha256.txt 为准。

## 交付内容

- `server/node/`：Node(Fastify 5.12.8)/pg(8.23.1)/pg-boss(12.38.1) 科学服务。
  - `migrations.ts` — 迁移 1–14 与 server/db.py 逐字一致（drift guard 测试比对 statement+rollback note），15–17 新增：fence/lease/cancel/queue_job_id 列、`science_operations`（操作回执，UNIQUE(workspace,operation,idempotency_key)）、`experiment_runs`（Run 写权威，operation_pk UNIQUE、content_sha256、governing_plan）。
  - `ledger.ts` — 领域账本：条件 UPDATE 认领（fence 自增）、租约续期、`commitRun` 单一短事务发布点（Run+回执+attempt+outbox；cancel 竞争时丢弃结果不发布）、`settleWithoutRun`、`requestCancel`（queued 直接取消 / running 置 cancel_requested）、`requeueExpiredLeases` 恢复器。
  - `engine.ts` — 独占 engine_once 子进程运行器（SIGTERM→SIGKILL，'close' 后才算确认退出；PPID 守卫防孤儿）。
  - `prepare.ts` — 血统注入（fork/compare 的父 Run 与治理 plan 从 PG 读出注入 priorRuns/priorPlans）+ 候选二次校验（validateImportedRun + Registry outputSchema + kind/parent 断言）。
  - `worker.ts` — pg-boss 消费（batchSize 1、taskId 校验）、后台租约续期、取消轮询、崩溃释放/重投。
  - `api.ts` — `/api/v1/science/*`：operations（服务端 planInputDigest、事务内 boss.send、send=null 回滚 503、同键同 payload 回放 / 异 payload 409）、tasks/runs 查询、cancel、health（读 PG 不碰引擎）。
  - `main.ts` — 迁移→boss(独立 schema paper2lab_boss)→worker→API；SIGINT/SIGTERM 有界停机。
  - `science.test.ts` — 9 项定向测试（真实 PG paper2lab_node_science_test + 真实 bundle 引擎）。
- `scripts/engine_once.ts` + 重建 `engine_once.mjs`：新增 `--candidate` stdin 模式（不读不写 JSONL；legacy argv 路径逐行保留）。
- `server/jobs.py`：`reconcile_queued`/`claim_task` 增加 `kind='parse'` 过滤——Python RQ 账本不再误领 kind='science' 任务（Python 侧本就只创建 parse 任务，行为不变）。
- `package.json`/`pnpm-lock.yaml`：精确锁 fastify@5.12.8、pg@8.23.1、pg-boss@12.38.1、@types/pg@8.23.1（均 MIT）。`tsconfig.json` include 增 server/node。

## 定向测试（tests.log，9/9）

1. formula.plot 真 Run 提交（361 点，peak 1.9999533044868116，integral 16.984760232813088）+ 幂等回放（同 taskId、仍 1 条 Run）+ 同键异 payload 409。
2. 无 plan → needs_input，零 Run。
3. 幽灵 fork → 提交时 422。
4. fork 挂 PG 父 Run（parent_run_id 正确，peak 2.9999299567302176）。
5. 长算取消隔离：取消 A（引擎 SIGTERM 确认死亡 processAlive=false）不影响并行 B 提交；A 零发布，回执保留 usage（enginePid/engineExit/engineArtifact）。
6. 长算期间 health 200 且租约持续推进（owner 不变）。
7. 旧 fence 提交被拒（'fenced'）且零 Run；现役 fence 提交成功；任务终态后重复提交亦 'fenced'。
8. 提交前崩溃（beforeCommit 抛出）→ 无 Run；pg-boss 重投后恰好 1 条 Run。
9. 迁移 1–14 与 db.py 逐字一致（drift guard）。

## 实际运行（dev-server.log + paper2lab_node_dev）

- 启动：`PAPER2LAB_DATABASE_URL=postgresql:///paper2lab_node_dev?host=/tmp PAPER2LAB_NODE_PORT=8790 node --import tsx server/node/main.ts` — 迁移 0→17，重启幂等（17→17），引擎 bundle 钉住 sha256:05cdcfe26dbd…。
- HTTP 真链：POST operations→202(taskId,queueJobId)→worker 消费→GET tasks/1 succeeded→GET runs 返回 361 点 Run（数值与 legacy /api/engine/execute 完全一致）→ 同请求重发 200 replayed→fork（parent 正确）→ 长算 cancel_requested→cancelled 零发布。
- outbox 事件流：`task.queued→task.running→engine.started→run.committed`（×2）与 `…→task.cancel_requested→task.cancelled`。
- legacy 回归：8788 `/api/engine/execute` 相同请求 peak 1.9999533044868116（临时拉起验证后已释放端口）。
- 相邻套件：`pnpm exec vitest run src/skills src/experiments scripts/engine_persist.test.ts` 338/338。

## 范围与未签收

- 未触及 CLI-144（server/tests、workflows）与 CLI-111（src/desk、formulaPlan/Executor、devservers、vite.config）文件。
- Python 破坏性套件（test_jobs_j11 等）属 CLI-144 隔离门，本轮未运行；jobs.py 改动为加法过滤，不影响既有 parse 行为。
- DSH/真实 Qwen 属 CLI-146/93，本轮未做。once 优先/bridge 回退的"校准"以 once-bundle 真实执行 + legacy HTTP 回归覆盖；常驻 bridge 长链路未另测（现有 CI 已覆盖 engine_bridge）。
