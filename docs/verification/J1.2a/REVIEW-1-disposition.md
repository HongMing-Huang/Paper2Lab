# J1.2a 复核处置（第 1 轮 → 第 2 轮修复）

第 1 轮独立只读复核（Explore 子 Agent，2026-11-06 晚）：无 blocker；2 major + 4 minor + 5 note。全部 major/minor 已修，冻结身份见 after-sha256-round2.txt。

| ID | 结论 | 处置 |
|---|---|---|
| M-1 bundle 缺 PPID 守卫 | 属实（源码在构建后才加守卫） | 重建 bundle；**且回归测试暴露原守卫设计本身无效**：主线程 setInterval 在同步计算中永不触发。改为 worker_threads 看门狗（独立事件循环，SIGKILL 自身）+ spawner 经 `PAPER2LAB_ENGINE_OWNER_PID` 传期望 owner（覆盖“父进程先于子进程启动即死”的竞态）。新增 `orphan.test.ts` 驱动**实际交付的 bundle**：真实 10s kakeya 计算中父进程死亡 → 0.76s 内引擎退出。 |
| M-2 cancel_requested 在 requeue 路径丢失 | 属实（claim 清除了标志） | claim 不再清标志；`cancel_requested_at IS NOT NULL` 的 queued 任务在下一次投递时直接终结为 cancelled（不重算）；`releaseClaim` 遇取消标志直接 settle cancelled。新增测试覆盖 release 与 lease 过期两条路径，零 Run。 |
| m-1 needs_input 消耗 operationId | 属实（与 toolPort A1.2 语义相悖） | API 预检在落账前执行执行器的 plan 门：正式技能缺 plan / plan 不覆盖技能 / 不覆盖输入 → 422 needs_input（不建 task/operation）；fork 源 Run 无治理 plan 且未提交 plan → 422。API 进程不再注册 plan（无进程全局状态）。新增 FORMAL_SKILLS 漂移守卫（预检集合 = executor.ts FORMAL_SKILLS）。测试改为：同一 operationId 先 422 后补 plan 202 并完成。 |
| m-2 drift guard 可静默空过 | 属实 | 去掉 `?? ''` 回退；ddl/record 各须恰好 14 个；v10 后缀捕获并全串 `toBe` 比较。 |
| m-3 租约续期断言近似恒真 | 属实 | 等待越过一次续期（8.2s，续期间隔 7.5s，计算约 10s 仍在跑），断言 expiry 前移 > 5s；续期后 health 再验一次。 |
| m-4 缺提交后崩溃链路测试 | 属实 | 新增 afterCommit 抛出用例：pg-boss 重投 → claim 记录 task.delivery_skipped → 仍恰好 1 条 Run、操作态 completed 不变。 |
| n-3 查询/取消无 workspace 过滤 | 采纳 | GET runs?taskId、GET tasks/:id、POST cancel 均按 workspace 归属过滤（cancel 先验 ownsTask）。 |
| n-1/n-2 浪费型竞态 | 记录 | 无正确性影响；n-2 的孤儿计算现由 M-1 看门狗兜底。 |
| n-4 jobs.py finish/cancel 无 kind 过滤 | 记录 | 当前调用方只持 parse taskId，科学任务不可达；集成期提醒。 |
| n-5 | 无需处置 | — |

## 第 2 轮验证

- `pnpm exec vitest run server/node`：2 文件 13/13（tests-round2.log）。
- `pnpm exec tsc --noEmit -p .`：0 错误。
- legacy argv（重建后 bundle）：361 点 peak 1.9999533044868116，runlog 仍写 1 行（legacy 行为不变）。
- 相邻套件 `src/skills src/experiments scripts/engine_persist.test.ts`：338/338。
- 8790 服务重启实跑：缺 plan → 422 needs_input；同 operationId 补 plan → 202 → succeeded（dev-server-round2.log）。
