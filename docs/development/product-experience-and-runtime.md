# 产品体验与主运行时修订

> 后续运行证据见[实现调查](../research/implementation-investigation-20261106/README.md)：DSH真实SDK握手已过但Qwen未验；PDF.js读取harmonic第一页117项，Lorenz扫描件第一页0项；Node原生渲染进程退出139，根因未定。新默认TS摄入路径尚不能取代已有扫描/OCR消费者，先验证可用页面图像与转写质量。

2026-11-06，按用户最新指令。本文覆盖旧计划中“AgentScope先行、DSH仅试点、Python/RQ为新主服务前提”的决策；历史研究证据原样保留。当前SOURCE表示源码/官方资料核对，DESIGN表示待实现，未新增产品/模型RUN。

当前源码核查基于0c04研究工作树及固定上游源码。桌面主项目已有ZCode活跃开发（其STATE报告B0/S1/A1等推进），该进度不能被本工作树旧todo覆盖。主会话在子项边界应用本修订，保留已验证科学修复与SQL/数据资产，Agent/服务适配等受影响部分标needs_revalidation后迁移，不把已做工作全部清零。本轮不直接改写其活跃PLAN/STATE或生产文件。

## 1. 第一目标用户与首个价值

第一目标用户是能读基础公式、想理解论文数学对象的大学阶段学习者与早期研究者。首先帮助其“通过一个可操作问题理解论文中的一个对象，留下可继续研究的真实实验”，不要求读完整篇证明，不承诺游戏替代科研证明。

同一模型有探索与研究两种深度：探索默认生活情境、可操作对象和即时因果反馈；研究按需展开公式、条件、精度、来源、对比和引用。自由探索可无Goal，挑战增加冻结目标/预算，不复制数学状态。一个可见AI助手承接查源、创作、辅导、研究导演，权限随任务收窄；不出现四个聊天窗口。System Atlas是内部文档，不作为产品主界面。

## 2. 四个画面与操作合同（全部DESIGN）

| 画面 | 用户看到 / 做什么 | 操作后真正发生什么 | 失败 / Agent介入 | 用户带走什么 |
|---|---|---|---|---|
| Paper Desk：论文入口 | 可读PDF、一个研究问题、少量可探索对象；上传或打开保存世界，选择“先探索/看定义” | PDF版本/解析件/来源；DSH驱动Qwen查原文并提模型候选，展示可操作自由度/条件，用户打开对应世界 | 解析失败仍读原PDF；关键转写歧义定位原文，必要时问一次；不可执行对象明确说明，不塞假3D | 确认的问题、模型、来源与世界入口 |
| MathWorld：世界主体 | 数学对象占主要视野；一句目标、允许动作、preview/正式结果。抓取对象、预测、尝试、重试或自由探索 | 输入→Host→合法数学调用→Run→候选/独立Goal→原子提交→直接反馈；公式与对象双向操作同参数 | 非法动作停在最后合法状态；未获胜解释哪项条件未满足；数值unknown不算输赢。Agent只在首次进入、请求提示、关键失败/里程碑介入 | 具体尝试、后果、可比较的发现 |
| AI引导与数学理解：世界内渐进层 | 同一个助手的短提示、预测入口、可展开公式与来源；依次查看直觉→现象→定义→论文 | 提示绑定当前对象/动作/Run；用户可要求“只给方向/看原因/查原文”，DSH调用授权来源与实验工具 | 用户可忽略/静音提示；AI推测明确标识；测量值由Run投影，AI不得补数值或泄露盲测答案 | 为什么成功/失败，结论适用范围及下一问题 |
| Research Space：保存与继续 | 研究时间线、分支、源论文关系和未决问题；保存世界、Fork、Compare、从原位置继续 | 引用版本化来源/模型/程序/Run/动作游标/解释；恢复相同尝试，Agent根据已有回执提出下一分支 | 未持久提交显示待保存/重试；刷新不重复Fork；旧模型/规则仍可追溯，过期回答不写新分支 | 可复现研究记录，而不是一段聊天摘要 |

三空间是同一workspace的视角，AI引导是世界内层，不另造四套路由/科学Store。转场保存sourceAnchor/runId/attemptId/相机和布局；返回论文定位原区域，返回世界保留同一尝试。

## 3. Kakeya首秀与通用性分开验收

Kakeya保留为产品第一展示：从“有限空间怎样容纳不同方向的线段”进入；先固定方向集/数量、δ、seed、分辨率与计分条件，再允许合法packing操作。玩家先预测占据空间的变化，拖动管束观察preview，释放后真实Worker计算覆盖/重数/并集体积；失败指出具体未满足条件，成功解释有限尺度现象并可查看原文。不能调松阈值过关，更不能写“证明Kakeya定理”。第一轮后可选择再挑战、比较排列、查来源或保存下次继续。

Kakeya首秀沿用现有专用资产，不把它签收为自动生成成功。C1仍需支持域内一篇未预装专属模型的真实PDF候选/确认/Run链；E1仍以同SPD模型两个真正不同的World Program检验生成能力，不把“换参数”当新机制。Kakeya的产品连贯性与SPD的通用生成证据各自保存，两者不能拼截图冒充同一链。

## 4. 成熟产品如何转化为本产品规则

- PhET的引导探究与预测/实验活动启发“先猜再试、用直接后果解释”，不把讲解长文放在第一次操作之前。[官方教学资源](https://phet.colorado.edu/en/teaching-resources/teaching-with-phet)。该站网页部分动态内容本轮提取有限，具体教学研究不作未经核实的成效背书。预测与实验的具体方法可核对[官方概念问题指导](https://phet.colorado.edu/assets/virtual-workshop/Concept_Questions_and_Peer_Instruction.pdf)。
- Polypad把对象选择、移动、旋转与上下文动作直接放在对象附近，并支持保存/分享画布；Paper2Lab据此将动作与解释贴近对象，把保存变成研究快照，而非另开参数Dashboard。[官方教师指南](https://mathigon.org/downloads/polypad/guide.pdf)。借鉴体验不等于获得商业嵌入授权或接入其SDK。
- GeoGebra Activity将说明、动态数学对象与问题组织为活动；Paper Desk只露出当前问题与一个实验入口，Research Space再展开关系。[官方Activity资源说明](https://help.geogebra.org/hc/en-us/articles/10828122740765-Create-GeoGebra-Resources)。具体Activity行为以所链接官方页面为准，不能由界面宣传推导本项目已支持。

这些是官方资料支持的体验借鉴；本轮未声称完成真实用户测试、教学效果验证或对方产品SDK集成。

## 5. 明确的技术决定

**新主链选择TypeScript/Node + pnpm + DeepSeek Harness官方TypeScript SDK。**DSH直接成为产品Agent运行时，取代新增AgentScope编排；停止围绕旧Python SDK再造桥。包管理继续pnpm，锁版本和生命周期；默认上下文检查已改为Node内置模块脚本verify_agent_context.mjs，旧.py仅留作历史工具；不将uv设为新主工程前提。DSH是Harness，Qwen是模型，两者不是互斥选项。

目标调用：浏览器/tldraw/R3F → Node/TS应用端口 → `@deepseek-ai/dsh-sdk-client`驱动受管DSH进程 → TS科学/来源/世界插件 → 同一Registry/PlayPlan/executor → ExperimentRun/领域回执 → DSH下一决策 → UI事件与应用ack。Plugin与Session接口按同一锁定SDK/runtime/plugin版本核实；不得混用本地旧应用、npm新client和不同源码版本。

官方TS SDK存在真实`DeepSeekHarness`、`HarnessSession`及`run/onNotification`，stdio JSON-RPC是进程边界，无需Python调用Agent。[官方TS SDK](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md)。工具经`defineTool`/注册适配现有Registry；scope工具过滤不替代对象级授权。插件只得到受限科学执行端口，不开放任意shell/fs/net给模型或World guest。

固定研究commit ce7073d51254c26cd63b22a60835b8f948deb447可核对[SDK api.ts](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/sdk/client/src/api.ts)、[工具schema](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/core/tools/src/schema.ts)、[provider路由](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/llm/llm-pi-ai/src/index.ts)与[协议types](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/sdk/protocol/src/types.ts)。该版本公开协议无通用session/cancel；超时只结束等待不等于停止工作，首期按activation独占runtime/科学执行单元，取消确认进程退出；不能杀共享其他任务。应用await close须核对所有子进程退出，Session的idle不等于科学completed。

Qwen接入须实测provider配置、endpoint/model、工具参数与结果回填、thinking行为、stream/取消；“OpenAI兼容”不能当运行成功。DSH管理推理/工具/Session/Subagent，Paper2Lab仍管理模型版本、Run、任务幂等/预算/权限/恢复；DSH jobs-local不是持久队列。首轮A1/A0直接验DSH+Qwen，不再等待“是否选DSH”的评选。

## 6. Python/uv逐项裁定

| 职责 | 当前事实 | 新主线与退出门 |
|---|---|---|
| 包管理 | package.json/pnpm-lock；uv仅在server/README旧安装示例，无uv.lock/pyproject | 主工程pnpm；不新增uv核心流程，旧说明标legacy |
| Agent | Python AgentScope/FastAPI SSE确有实现 | 用Node/TS + 官方DSH TS SDK接管；等实际工具/错误/取消/恢复及UI回归后停写旧Agent入口 |
| 数学核 | Cortex/TS/Worker、Kakeya、MuJoCo WASM及通用ODE runner | 保留并直连TS；不为DSH重写数学核，不把Python当默认数值路由 |
| 论文解析 | Docling、pypdfium2+VLM渲染是真Python消费者 | 新默认链采用PDF.js原文/坐标文本和页面图像→受限VLM转写→来源确认；支持域明确。移除Docling前用同PDF语料比公式/表格/OCR/锚点/耗时成本与失败。未等价就返回unsupported或显式可选legacy解析，不能强制新主链依赖Python |
| SciPy/Pyodide | 旧ODE页面实际使用，不是仅接口 | 不作为新默认路径；保留旧回归入口，等TS能力/误差门覆盖后另审退休。浏览器Pyodide仍含Python运行时，不能称完全无Python |
| 持久任务 | RQ已作为J1.1 legacy解析实现并在最新STATE待增量复核 | J1.1保留legacy范围；J1.2a/b采用Node+pg-boss受管执行与同一PostgreSQL任务/attempt/outbox权威。不为删除Python自造通用队列框架，也不把DSH Session当Job DB |

因此目标是**新默认产品链不要求Python或uv**，不是宣称现库已经没有Python。删除旧Python前逐消费者替代、回归并确认无写入者。P1须尽早暴露新PDF路径质量，不能等到最后才发现公式来源丢失。

## 7. 映射到原有任务与验收

保留21工作包与原已验收legacy范围，当前细分以PLAN §4.1a为准（J1.2a/b、J1.CI）。不重定义已done的B0.3/A1/P1：J1.CI校准Node/DSH及测试资源，J1.2a接新科学任务，J1.2b接DSH插件/SDK；A0.3显式消费J1.2b并验真Qwen。A2.1落实新默认TS PDF页图/转写/锚点质量门并集成来源/模型/任务，A2.3验持久Session与工具批次恢复。旧Python测试保留旧链回归，不作为新主线全局前置，也不能替代新链验收。

U1/C1验Paper Desk与Kakeya入口连贯、未预装论文语义链、世界/来源/记录往返；U2/E1验完整交互节奏与SPD动态生成；Research Space的最小保存/继续属于C1，深引用关系随L1/E2递进。新增四画面设计必须记录用户看到什么/可做什么/真实后果/失败/Agent触发/数据来源，不能再以Atlas模块动画签收产品体验。

Intel本地AI只按明确比赛环境新增独立验收：设备/模型/provider/version、真实本地推理记录、具体贡献、与云端Qwen各自来源。未运行就标未验；不暗下载大模型、不新增付费调用，不以“端云协同”连线冒充Intel实测。本轮未将具体硬件型号或性能写成既成事实。

本轮仅改设计和开发合同；没有生产迁移、安装、真实Qwen/DSH请求或新产品Run。历史No-Go保留其当时证据边界，新选型由当前用户指令覆盖，不把新决定写成运行验证已通过。

后端可执行细化见[产品操作到API/事务/恢复](backend-implementation.md)与[官方Node源码/API核对](backend-node-sources-20261106.md)，补齐StudySpace、预测与Action、提示时效、快照和下一关发布。它们为当前设计，不是新API已上线。
