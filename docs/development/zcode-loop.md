# 在ZCode启动Paper2Lab开发loop

2026-11-05核对。本机`/opt/homebrew/bin/zcode`返回CLI版本0.17.1，`--help`列出下文使用的参数。只运行了version/help，未启动模型开发回合、修改全局配置或验证账号连接。CLI版本不等于桌面版本，官网描述也不保证本地每个功能都已配置。

开发prompt在根目录[DEVELOPMENT_PROMPT.md](../../DEVELOPMENT_PROMPT.md)，执行协议为[LOOP](../../LOOP.md)，任务合同为[PLAN](../../PLAN.md)，进度当前为[STATE](../../STATE.md)，Linear已导入，以实际issue为任务权威。不是新的任务系统，也没有`zcode loop`命令。

## 先检查文件，再启动

本机另有Codex的0c04工作树，未提交文档曾仅存在于那里。2026-11-06已把开发上下文与完整研究副本补齐到桌面主项目；以下命令明确打开桌面主项目。两份代码基线/用户改动应分别检查，不能跨目录沿用测试结果；同一目录只能有一个生产写者，跨目录并行也须先满足协调合同。

```sh
cd /Users/c14h14n3/Desktop/Paper2Lab
node docs/development/verify_agent_context.mjs --root .
```

检查通过后，仍须按prompt阅读内容。Git历史/远程仓库尚不包含这些未提交文件；云端Agent不能仅凭GitHub地址取得本地文档。

## 推荐：选定工作树中的交互任务

终端启动：

```sh
zcode --cwd /Users/c14h14n3/Desktop/Paper2Lab --workflow-mode disabled
```

无参数命令进入TUI；这里显式指定工作目录。进入后使用`/model`检查已配置模型，使用`/mode edit`选择允许工作区编辑的模式，再粘贴根目录DEVELOPMENT_PROMPT.md全文发送。edit通常免文件编辑确认，终端等操作仍可能需要宿主审批；无需把模式切成plan来执行开发。

桌面版则打开**桌面主项目Paper2Lab目录**为workspace，创建一个开发任务，引用AGENTS/STATE/LOOP/PLAN/DEVELOPMENT_PROMPT，发送“读取DEVELOPMENT_PROMPT.md并按其立即启动开发loop，从STATE恢复”。不要同时在CLI和桌面开启两个生产写者。

首轮按角色读取当前合同/issue及直接研究来源，核对源码/once/bundle；已有基线不重做B0或吞全文研究。多窗口先读[协调合同](COORDINATION.md)，Linear已导入，但ZCode连接需本窗口实查；完整基线/分派/资源未就绪阶段仅原集成窗口写生产。只回复研究总结或另建大计划不是启动成功。账号/模型尚未配置时按ZCode本身的连接入口处理，不把供应商失败伪装成工作已完成。

`--workflow-mode disabled`只关闭ZCode额外动态工作流，不关闭Agent工具循环或我们用prompt定义的开发loop。先用单主Agent+受控只读子Agent，避免另一自动工作流同时创建写者或另存进度。无需开启目标模式或安装新插件才能执行本计划。

## 恢复

```sh
zcode --cwd /Users/c14h14n3/Desktop/Paper2Lab --continue --workflow-mode disabled
```

若最近会话不是开发会话，用本地实际的sessionId：

```sh
zcode --cwd /Users/c14h14n3/Desktop/Paper2Lab --resume sess_REPLACE_WITH_REAL_ID --workflow-mode disabled
```

两种恢复参数不混用。恢复后发送“继续按DEVELOPMENT_PROMPT执行，先校验STATE、工作树、占用和未决回执，不从头重跑”。断开任务不保证程序仍在运行；STATE与真实进程共同决定恢复动作。禁止用无限shell循环反复启动zcode，避免重复副作用与费用。

## 子Agent与工具

ZCode官方文档提供内置Explore（只读探索）和general-purpose。不同入口/版本的工具权限须实际检查，Explore不一定注入项目AGENTS；派发时显式带任务范围与约束。general-purpose并非天然只读，必须在任务中限制，不给它并发生产写权。

主Agent负责生产修改、测试执行、STATE；子Agent按当前需要查调用链/数学与权限/独立review，最多三个同时只读。无需为了该项目改写用户级`~/.zcode/agents/`；内置能力可先完成工作。没有子Agent能力就登记review门，不能通过再次自查冒充独立复核。

已有工具足够就使用；确需外部API文档再查官方来源/MCP；UI任务才启动浏览器。高强度指持续执行、有针对性的并行查证和真实验收，不是工具调用次数目标。不要批读归档.git、上传材料或执行第三方仓库脚本来“理解项目”。

## 非交互入口的限制

本机帮助也支持`--prompt`/`--attach`、`--target`、`--resume`。官方文档说明`--prompt`默认yolo，且build/edit遇审批时可能没有审批客户端；因此这里推荐交互入口，不提供依赖默认权限的无人值守命令。若以后采用批量运行，须另验证明确的权限模式、退出原因、工具实际执行、session/checkpoint及资源上限，退出0不等于产品验收。不要将`--prompt`和`--target`混用。

## 依据

- [CLI命令行参考](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/docs/usage/02-cli-reference.md)：cwd、会话恢复、动态工作流与参数边界。
- [CLI权限](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/docs/usage/05-permissions.md)：edit/build/yolo等模式及无审批客户端限制。
- [ZCode Agent](https://zcode.z.ai/cn/docs/agents)：工作区与项目AGENTS读取。
- [子智能体](https://zcode.z.ai/cn/docs/subagents)：Explore/general-purpose、项目指令与工具限制。

以上网页是核对当日的上游说明，本机命令以实际0.17.1的help和运行结果为准。本轮只验证启动参数存在，未声称真实供应商、子Agent或Paper2Lab开发回合已经在ZCode跑通。

## 多窗口启动时给AI的话

集成窗口：读取AGENTS/STATE/LOOP/PLAN与COORDINATION，保持当前J1.1写权，先收口终态增量review；不要为新窗口丢弃未提交实现。

工作者窗口：读取DEVELOPMENT_PROMPT的工作者角色，只处理协调者明确分派的issue/路径/base/worktree；未拿到真实任务ID或基线不完整时只读，不自行选下一项。

review窗口：按冻结hash只读审核，不修代码/STATE；共享数据测试禁止运行，除非提供独立资源。

启动命令本身不建立互斥、Linear登录或数据库隔离；不要复制三个同样的“继续开发”prompt到同一目录。

本轮真实任务与可粘贴角色文本见[WINDOW_PROMPTS](WINDOW_PROMPTS.md)。Codex的Linear认证不会自动赋给ZCode；先实际读CLI-100，不能凭“已连接”消息假称本客户端具备工具。
