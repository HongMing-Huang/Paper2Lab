# J1.1 收口记录（CLI-100）

2026-11-06。范围：PLAN J1.1 原合同，按 AGENTS/PLAN §4.1a 以 **legacy 解析范围**（Python/FastAPI + PG 账本 + Redis/RQ + Docling）验收；不代表 J1.2a/b 新 Node/pg-boss 科学执行链。完整执行记录（开工卡、方向修正、F1 失败记录、诚实登记①–⑰）在导入快照 `docs/verification/linear-20261106/source-STATE.md` 的“J1.1 开工卡与执行记录”节，本文件不复制。

## 代码身份（签收时；无 commit 授权，以文件 sha256 冻结）

```
a20db3ae3cb02f2bf11dc21f067177551ff47174a81c963347376251232b3171  server/jobs.py
9c18141974a1ba43ffd23799a0d031e51533d6b524507171e423f8ac2088cad3  server/parse_worker.py
2edbbe235b89fa40005106e21b57fe57d737f113b39e7f2c7cff1f677ec4de4f  server/ingest_runner.py
d3404d4e66e469a06fced552af3440bccd67b424853e8be6ea80cb92099cc62a  server/parse_store.py
971e71c4bd19fa8156d092ab6c09fbd01cdcc8a4dc43d3b9db8855250bdbb27b  server/db.py
620bcd2644a304380b52134118e6c57a68500e245538648009daf152b72fe58a  server/main.py
8cb466d89e0b4c779a29fe8776889bbf09c512de97125dbb6acbcf05f53ee465  server/requirements.txt
37a9062d710541a2dd84d54e33c679b0f16094d511d53f3b441fd1e28b368552  server/tests/test_jobs_j11.py
cec2ec838f3cd0296d998c882e8137423238b3b329131691326195a35e93d3cc  server/tests/test_parse_artifacts_p12.py
```

基线 HEAD 37352d9e09f2e2c5f63017b3cfffc33471e708e0 + 未提交工作树；main.py/db.py 同时含已签收的 D1/P1 改动。

## 三轮独立只读复核

| 轮 | 冻结身份 | 结论 | 处置 |
|---|---|---|---|
| 1 | attempt-2 首版（jobs 0332505a…） | 有条件通过：十项探针全 PASS（8 进程并发 claim 仅 1 赢家、reconcile 5 连幂等、超时连杀两 hang 子进程 worker 存活、Redis 不可达可恢复、回退路径与 HEAD diff 0、warm 子进程搬移逐行一致）；必修 1 项=STATE 计数误写 | 计数更正；should-fix 单事务（oracle 证旧双提交留 1 孤儿文档）已修 |
| 2 | 单事务修复（jobs 500bf767…） | 有条件通过：代码 A–E/G 全 PASS（单事务六失败分支 B1–B6）；必修 M1–M3 均为 STATE 文字；**复现预存缺陷 F1**（RQ 执行条目 60s 间隙内删陈旧 job 抛错→reconcile 未守卫致 worker 启动崩溃、整轮中止） | M1 补归档 r2/r3 原始日志；M2/M3 改正；F1 红→绿（逐任务守卫，attempt-3/red.log→green-run1..3）；finish_task 事务归调用方；标签改 "result commit failed" |
| 3 | attempt-3（本文件身份） | **通过**，无必修："J1.1 can be signed done"。在 db14 用真实 `parse_worker --burst` 复现 RQ 60s 窗口：旧代码启动 #2 抛错且丢任务 B；新代码启动 #3 跳过 A、完成 B；启动 #4 恢复 A。归档 red/green 日志与 /tmp 原件逐字节一致 | 见下“携带项” |

复核 3 的测试运行在共享 DB15/PG 上进行：由集成窗口串行化（复核期间主会话不触碰测试库），无并发破坏性运行；新 COORDINATION 规则下独立 R 窗口无独立资源时不得如此运行。

## 集成复验（签收前，本文件身份）

- `test_jobs_j11.py -k "not real_docling"`：15 passed（integration/quick-15-green.log）。
- 全量快集 213 passed 4 deselected（attempt-3/pytest-full-quick.log）；真实论文经队列 worker 57.4s 绿（attempt-3/real-docling-green.log）——两者运行于同一身份（attempt-3 之后 9 文件未再改动，签收前 hash 复核一致）。

## 携带项（非阻断，均已登记去处）

- jobs.py:148 用 `{exc!r}` 记日志，redis-py 8.1 下丢失 host/port/errno → 改 `f"{type(exc).__name__}: {exc}"`；随下次触及 legacy 解析链时修。
- reconcile 失败若发生在 enqueue_call 之后，job 已在 Redis 而 rq_job_id 为 NULL——"留 queued 待后续" 表述略不准；claim 原子性使其无害。
- test_jobs_j11.py:298-323 缺"UPDATE 之后的 DB 侧失败 + 断言 stderr 含 task id"用例 → 并入 CLI-144（J1.CI 改造测试夹具时补）。
- 导入快照 source-STATE.md 中两处文字不精确（回归行止于 212 而 213 见他处；"单条坏RQ记录"低估了守卫——任意异常均跳过，PG 断连仍按设计中止整轮）。快照为历史，不改写，以本条为准。
- 长驻 worker 跳过的任务要等下一次 worker/API **启动**才重试（周期 reconcile 归 J1.3，见登记④）。
