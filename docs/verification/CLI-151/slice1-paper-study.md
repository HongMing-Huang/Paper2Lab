# CLI-151 切片一：陌生 PDF → 立即可读 → 来源化请求候选 → 真实 Run（2026-11-07）

同一输入全程：`public/papers/ode-spring-params.pdf`（1 页，23,483 B；sha256 前缀见界面），本机 Chrome（Playwright），入口 `zsh scripts/dev-mvp.sh` → http://127.0.0.1:5178 。三服务：8788 Python 解析、8790 Node 科学（引擎制品 `scripts/engine_once.mjs` sha256:76c96c80…）、5178 Vite。

## 用户现在能做什么

1. 拖入 PDF → 立刻进入「论文研究空间」：PDF.js 画出原文，浏览器读文本层（每行页/区域、parser `pdfjs-text@4.10.38`、整篇 sha256、覆盖「文本层已读 k/N 页」）；无文本层页如实标「尚未读到」。
2. 「精读本页」：只对当前页发 `/api/ingest`（`pages=N`，Docling 或 VLM），返回区域锚点的结构化公式；坐标/页码保持全局，`coverage.complete=false` 防止单页冒充全文。
3. 选中结构化公式 → 候选：按数学结构匹配（`\dot{x}=…` 方程组 → model.solve；显式函数 → formula.plot），每个参数/初值标「论文第 N 页 · parser「原句」」或「你提供（实验假设）」或「缺」；积分区间/自变量范围永远是用户选择。转写可在候选里纠正。
4. 可执行时「提交真实计算」→ Node operation → 任务/worker/fencing → 引擎进程 → PG 原子 Run；界面显示 Run、曲线、per-state min/max 与分段时间。
5. 「完整解析 → 实验台」仍可进入原有桌面（路由命中预装模型时）；未命中如实说明并留在研究空间。

## 实测（单样本，不是分布）

| 阶段 | 时间 | 测量位置 |
|---|---|---|
| 原文首屏（拖入→第 1 页画出） | 592 ms | 浏览器 |
| PDF.js 打开文档 / 文本层第 1 页 | 251 ms / 20 ms（21 行，895 字符） | 浏览器 |
| 精读第 1 页（提交→结果到达） | 47.3 s；暖样本 2：45.3 s | 浏览器 |
| └ docling.convert | 46.5 s / 44.7 s（模型已在进程内） | 解析进程 |
| 　├ 公式识别模型 doc_enrich | 45.5 s / 43.9 s | docling profiler |
| 　└ 版面模型 layout | 0.87 s / 0.58 s | docling profiler |
| 冷启动对照（重启后首个整篇解析，旧计时） | 451 s 墙钟 | 服务端 job |
| 计算：提交→浏览器观察到完成 | 647 ms | 浏览器 |
| ├ 任务排队（提交→领取） | 270 ms | PG 时钟 |
| ├ 引擎进程（创建→退出，每任务一进程） | 260 ms | worker |
| │ ├ Node 启动+制品导入 | 128 ms | 引擎进程 |
| │ └ 执行（计划门+编译+计算+封存） | 81 ms | 引擎进程 |
| └ Run.durationMs（RK4 本身） | 7 ms | 引擎进程 |
| 读取 Run | 30 ms，14.8 KB | 浏览器 |

结论（据此，不据推测）：解析链 98% 时间在 Docling 公式识别模型（CPU）；计算链里数学只占 7 ms，主要是排队轮询与每任务引擎冷启动。尚未改框架。

Run：`model-solved-mw5kbubf-e34iv-0`（resolved，CALCULATED，model-rk4@0.1）：x∈[−0.5688, 1]、y∈[−1.1012, 0.6263]、窗口内无周期（衰减信号，符合既有合同）。

## 本切片发现并修复的真实缺陷

- **内核**：自治方程右端为裸符号（ẋ = y）时，重命名后的 `v1` 被 Cortex 规范成下标 `v_1`，环境不绑定 → 第一步 NaN → 报 "diverged"。旧桌面路径只因 Docling 留下的 `y ,`（Tuple）而侥幸通过。修复：`compileModelRhs` 对顶层裸符号包成 `v1 + 0`；`modelPapers.test.ts` 增 1 条回归断言（25/25）。

## 负例（真实界面逐一验证）

右端加 `\sin(t)` → 不支持（非自治）；加未知符号 `m` → 缺条件（m 论文无值，提交禁用）；`… +` → 不支持（Cortex unexpected-operator，要求对照原文纠正）；左端改成 `y = …` → 不支持且方程保留可改回；恢复 → 可执行。

## 独立只读复核与处置（2026-11-07）

只读子代理复核结论：无 blocker；3 major / 4 minor / 3 note。处置（全部完成并复验）：

- **M1** ODE 分支漏检关系式（`\dot{x} = x \le 3` 会积分成 0/1）→ 每条方程过 `RELATIONAL`，界面实测"是关系式/不等式，不是微分方程"。
- **M2** `ingestPdf` 把 superseded 当可重试错误→重传同 clientId 反杀新任务；且最终误报"Docling 服务未启动"→ superseded 终态直抛。
- **M3** `mathworld/kernels.ts compileOdeSystem` 未镜像裸符号包裹（预览 NaN、正式 Run 正常→两者分歧）→ 同款 `v1+0` 包裹（本会话在复核前已独立发现并修复）。
- **m4** 希腊/常数折叠不可见（`\gamma`/`µ` 从自由符号消失、unicode β 不被发现）→ `symbolsOfParsed`：解析树扫描符号 + `\mathrm` 保护 + unicode 归一；`e`→欧拉数提示、`i`→不支持（仅实数）。
- **m5** `_timing` 混入持久化文档 → `result.pop("_timing")`。
- **m6** 同页两次精读竞态（旧 superseded 覆盖新状态）→ epoch 守卫 + AbortController 中止旧轮询。
- **m7** 页码先转换后报错 → 转换前 pypdfium 页数校验。
- **n8** AI 指针 id 同长碰撞 → 内容哈希 id。
- **n9** `formula.plot` 对名为 `e` 的参数静默折叠（复核确认存在）→ 候选阶段以 note 提示改字母（内核级修复留 executor 计划）。
- **n10** 候选合同零测试 → `modelPapers.test.ts` 增 1 条（真实 spring fixture：正例 ready+论文来源、缺区间 needs_input、关系式/显含 t/乱码 unsupported），5/5。
- **卸载中止**：研究空间卸载/换页精读时旧轮询 abort（服务端解析继续，回执照常落账）。

## 结果二补齐（同日）

- Run 过期标记：候选任何输入（LaTeX/参数/初值/区间）改动后，已提交 Run 标 stale 并要求重算（对照 Run 记录的 spec.model，逐字段）。实测：改右端→stale 提示出现；恢复→重算后消失。
- 取消：queued/running 可请求取消（`POST /tasks/:id/cancel`，worker 杀自有引擎进程后回执落账）。
- 未做：计算缓存/有效复用、pg-boss notifyWorker 去轮询排队（排队 ~250 ms 主要来自 0.5 s 轮询间隔——已定位，改动留给下一小片）。

## 结果三最小缺口：候选 Run → 可操作世界（同日）

- `src/study/worldFromRun.ts`：ready 的自治方程候选 + 其已提交 Run → `WorldDefinition`（方程/初值/参数名义值全部来自候选来源；**参数可调范围、可拖初值、目标是用户在表单里声明的游戏规则**，origin/rules 文案如实写明；显示轴范围取自这条真实 Run 的 per-state min/max）。显示前过 MathWorld 自己的 `validateWorld`。
- MathWorld 接收端：`mathworld.html?handoff=<id>` 一次性 localStorage 交接，origin 恒为 `edited`。
- 浏览器实操：spring 论文 → 候选 → Run → 设目标 |x(20)|≤0.001、c∈[0.25,0.75] → 生成 → MathWorld 打开（标题"ode-spring-params · x/y 方程组"，来源注明"由论文研究空间生成（非 AI）…起始 Run model-solved-…"）→ 真实指针拖 c 芯片 → 松手提交正式 model.solve → **独立判定：未满足，x(20) = −0.0062 低于下限 −0.001，还差 0.0052**（步长加密差 ±1.49e-9，两次 model.solve Run 落账）。
- 诚实边界：非自治/显式函数候选暂不生成世界（提示）；世界生成不依赖 AI。



- VLM 渐进片段与按页读、AI 回合（询问研究目标/分析）：本机未配置供应商凭据，代码路径只有类型检查与 fake 测试（`test_vlm_parse` 含 on_page/page_range/coverage 断言），未真实调用。
- 计算缓存未实现（每次提交新 Run，界面如实标）；pg-boss 轮询排队优化未做（已定位）；bridge 暖引擎对照未做；PG 提交耗时未单独计时。
- 旧产品脚本（需 8787 生产静态服务）已改为先点「完整解析 → 实验台」，未在本机运行；同一动作已在浏览器实测进入桌面。
- 定向测试：`test_vlm_parse`+`test_ingest_hardening`+`test_ingest_progress` 28/28；`modelPapers`+`executor`+`paperSpec` 25/25；未跑破坏性 PG/Redis 套件。
