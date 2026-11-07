# J1.2b（CLI-146）开发交付记录 — 2026-11-06 晚

owner：ZCode 新主会话。状态：**开发完成，进入测试阶段**（本轮用户指示：先完成全部功能开发，再统一测试）。真实 Qwen 回合验收依赖凭据，未配置时按 CLI-93 blocked-human 如实报告。

## 交付（身份见 after-sha256.txt）

1. **DSH 产品插件** `server/node/dsh/paper2lab-science-plugin.mjs`：运行于 DSH runtime 进程内，注册 5 个模型工具（science_run / science_fork / science_compare / science_read_run / science_list_runs），全部经 Node 科学 API（http://127.0.0.1:8790）调用同一 Registry/executor——runtime 不持有可写科学状态。每次模型工具调用映射为一条幂等 science operation（operationId = sha256(session, callId)），崩溃/恢复后重放回执不重复计算；exec.signal 取消时请求取消科学任务并等 worker 确认引擎进程退出。工具输出 schema 用 dsh-tools 值 DSL（additionalProperties 显式、可空字段 oneOf）；`presentationMeta` 携带结构化 run 引供 UI 回放。**guard 白名单**在执行层强制拒绝本插件之外的任何工具。
2. **产品 profile** `paper2lab-research.patch.yml`：llm-pi-ai 配 `qwen` provider（openai-completions，DashScope 国际站 compatible-mode，apiKeyEnv=PAPER2LAB_QWEN_API_KEY，模型 qwen-plus，显式 compat 声明——不依赖厂商目录探测）；禁用 shell/fs/web/子 Agent/workflow/schedule/skill/office 等全部通用工具插件（30+ 行）；遥测 DISABLED；研究助手人设（只报告工具算出的数字、有限尺度不当定理、缺输入如实说、不假装有 shell）。
3. **activation 运行器** `server/node/dsh/activate.ts`：从隔离安装动态加载官方 SDK；按 env 生成一次性 patch（模型/端点/上下文窗口/maxTokens 可覆盖）；DSH 子进程环境只给 PATH/HOME/TMPDIR/LANG + 唯一凭据 PAPER2LAB_QWEN_API_KEY（DSH_TELEMETRY_MODE=DISABLED）；新建或 resumeSession 跑一轮有界 run()；onNotification 采集完整 tool/call、tool/result（含 meta）、assistant/message（含 usage）轨迹；close 失败显式上报不吞。
4. **研究回合链**（服务端）：
   - 迁移 18：research_turns 表（回合/轨迹/回答/usage/会话引用）。
   - `researchLedger.ts`：kind='research' 任务账本（条件 UPDATE 认领、queued 时取消直接终结、幂等 settle）。
   - `researchWorker.ts`：pg-boss 消费（串行 1 并发）；**凭据未配置→turn 如实 settle failed（blocked-credential 文案），绝不假 AI**；续接会话注入已提交 Run 种子；runtime close 失败→回合 failed 不发布；run_ids 从工具回执 meta 收集。研究任务租约过期**不自动重投**（模型可能已计费，重复 prompt 双花）——排队中丢失投递才重发。
   - `researchApi.ts`：POST/GET turns、会话历史、cancel、health（configured/dshInstalled 如实报）；同会话同时只允许一个在途回合；CORS 仅回环源。
   - `main.ts`：单进程三角色（science worker + research worker + 同端口 API），研究 worker 启动失败不拖垮科学路径，启动日志如实报 Qwen 配置状态。
5. **parameterScale（服务端解析）**：`api.ts` 在 digest 前把 fork 的 parameterScale 按源 Run 记录值解析为绝对 parameterChanges——调用方（DSH 插件/前端）永不自行提交"声称来自 Run 的数字"。
6. **前端研究控制台** `src/research/ResearchConsole.tsx`：提问（⌘↵）、实时工具轨迹（调用/结果/错误徽章、Run 引用与指标）、模型回答显式标注「模型回答（model）」、会话续接/新开、右侧 CALCULATED Run 列表（SVG 曲线、参数、指标、血缘）、**显式非 AI 本地 fork 按钮（标注"非 AI"）**；后端不可达/凭据未配置如实显示。`App.tsx` 懒加载路由 + `Home.tsx` 入口按钮；`vite.config.ts` 最长前缀代理 `/api/v1/*`→8790（其余 /api 仍走 Python 后端，不覆盖 CLI-111 的端口约定）。
7. **隔离依赖**：`server/node/dsh/package.json` + pnpm-lock（@deepseek-ai/dsh-sdk-client@0.2.2-rc.1 + dsh-tools@0.2.2-rc.1；同系列 runtime 0.2.2-rc.1 随 SDK 传递安装；547MB node_modules 已被根 .gitignore 的 node_modules 规则忽略，不进产品锁/镜像）。隔离安装下 SDK 握手已实测通过（initialize/session cwd/close）。

## 明确不做（本轮边界）

- 不扩 AgentScope/SOP（agent.py 未动）；不造第二执行器/数学核/通用队列。
- 未触碰 CLI-144（server/tests、workflows）与 CLI-111 既有文件内容（vite.config 只加更长前缀路由）。
- paper.trace-source 经科学 API 显式 422 unsupported（候选引擎看不到全量历史，避免假阴性）；PG anchor 索引属后续切片。

## 测试阶段计划（下一步）

tsc → server/node 全套 vitest（含第 2 轮复核修复的回归）→ 迁移 17→18 实跑 → 8790 服务 HTTP（science+research 路由、preflight、parameterScale）→ 浏览器研究控制台 → DSH 握手（隔离安装）→ 真实 Qwen 回合（凭据在环境时；否则如实记录 blocked）。
