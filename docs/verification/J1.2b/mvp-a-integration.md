# MVP-A（CLI-151 步骤 1）集成切片 — 2026-11-07

owner：ZCode 主会话（CLI-145/146 owner，本切片为 CLI-151 步骤 1 的后端/主入口部分）。game owner 的 129/149/130/131 重叠路径未触碰。

## 修复清单（对应目标 A）

| 项 | 修复 | 证据 |
|---|---|---|
| 前轮 7 处 tsc 错误 | activate.ts 3 处（未用 import/类型收窄/残留 void）、researchApi 1 处（SDK_ENTRY 未导出）、researchWorker 1 处（ToolStep 转型）、ResearchConsole 2 处（可选链/数值收窄） | `pnpm exec tsc --noEmit -p .` exit=0（修复前后各跑一次，修复前 7 错全数复现） |
| DSH 会话历史路径 | 每次激活不再用一次性 tmpdir：会话历史持久化到 `<dataDir>/dsh-sessions/<sessionId>`（新会话在 staging 目录跑、close 后 rename；resume 前校验历史存在，缺失显式报错引导开新会话） | activate.ts bd07d9ad… |
| running 取消 | API cancel → worker 每秒轮询 cancel_requested_at → `ActivationCancelled`（close runtime 确认子进程退出、丢弃部分输出）→ settle cancelled | researchWorker.ts 7608072a… |
| 崩溃后明确终结/恢复 | reconciler：research 任务租约过期 + 30min 宽限 → settle failed `interrupted: owning activation lost its lease`（不自动重投，防双计费；queued 丢失投递仍重发） | 同上 |
| 新 API 鉴权 | `server/node/auth.ts`：PAPER2LAB_API_TOKEN（仅环境变量）设置时全部非 health 路由要求 Bearer；未设置=本地单用户开放 | fd3abe82… |
| 本地 fork 跟踪正式回执 | 前端 localFork 轮询 operation 至终态，completed 才加载新 Run 并显示 Run id；error/needs_input/cancelled 如实报 | ResearchConsole.tsx ac84ecc9… |
| 三服务启动/身份 | `scripts/dev-mvp.sh`（新文件，不动 CLI-111 的 devservers.sh）：Python 8788（/openapi.json 标题校验）+ Node 8790（/api/v1/science/health backend 字段校验）+ Vite（/api/v1 代理双向校验）；端口被非本服务占用即报错不杀 | 08895a98… |

## 实测记录

- `zsh scripts/dev-mvp.sh`：三服务起来，Node 迁移 17→18；research worker 随主进程启动；Qwen UNCONFIGURED 如实打印。
- `curl /api/v1/research/health`（经 5179 Vite 代理）：`{"ok":false,"configured":false,"dshInstalled":true,...}`——无凭据不假就绪。
- 真实计算经代理：op-mvp-smoke-1 → completed（formula.plot 361 点）；parameterScale fork（a×2，服务端按源 Run a=2 解析为 4）→ 新 Run peak 3.9999066、parent 正确。
- 浏览器（http://127.0.0.1:5179，独立端口避开另一自动化会话）：控制台挂载（6 Run 预载、凭据徽章如实）；提交问题 → 回合 failed 显示 blocked-credential 原文；点「本地 fork：a ×2（非 AI）」→ 通知显示新 Run formula-curve-mw5arjh4-zli79-0，DB 确认 peak 15.9996（源 a=8）、parent 链正确。
- 已知干扰：共享 Playwright 浏览器有第二自动化会话交错操作（观测到其对 5178 导航与另一回合提交"给我讲解一下这个论文"）；本切片验证改在独立 5179 完成并在 PG 交叉核对，未受影响。

## 未做/边界

- game 侧（129/149/130/131/112/150）由 game owner 按序推进；本切片不碰 src/mathworld、src/canvas。
- 真实 Qwen 回合仍凭据阻塞（CLI-93 blocked-human 维持）；credential 只查存在性。
- 本轮未写/运行测试；tsc/build/真实计算/浏览器实操如上。
