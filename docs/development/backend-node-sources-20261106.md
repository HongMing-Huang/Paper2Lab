# Node后端接入：官方API与不可省略的边界

> 后续隔离执行补证：见[2026-11-06实现调查](../research/implementation-investigation-20261106/README.md)。Fastify5.12.8/pg8.23.1/pg-boss12.38.1在独立PG16.14的事务/取消探针11/11；DSH SDK/runtime0.2.2-rc.1真实握手/Session目录/close 3/3。未验真实Qwen、产品恢复与故障竞争，不覆盖正文原始静态审查范围。npm latest与next不同，禁止混版本API。

2026-11-06。研究范围：官方文档与一手源码；未安装、运行队列/数据库/DSH、请求模型或修改生产代码。本文是后端实现依据，不是接入完成记录。主服务建议明确采用 **Fastify + node-postgres（pg）+ 官方DSH TS SDK；长任务适配优先pg-boss**，沿用已有PostgreSQL和领域schema，不再引入Python/RQ或Redis前置，也不自己实现通用持久队列。

## 1. Fastify只承担产品API，不能承担Agent Loop或科学正确性

`fastify.register(plugin, {prefix})`划分paper/research/world等逻辑路由；插件封装便于注入领域服务，不要求拆微服务。见[官方插件与封装](https://fastify.dev/docs/latest/Reference/Plugins/)。

`fastify.route({method,url,schema,handler})`可对body/query/params/headers做JSON Schema校验，并用响应schema限制返回字段，适合区分公开观测与私有实例。但schema是可信代码，不能把LLM生成schema直接交给Fastify编译；对象权限、模型revision和科学误差仍须领域服务验证。依据[官方校验/序列化](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)。

建议用同一Node应用的模块化路由、一个独立worker启动入口，复用同一领域服务/Registry。先不上GraphQL、通用workflow平台、五个微服务。浏览器SSE连接订阅已提交领域事件，不能直接把DSH内部通知当持久产品事件；UI断线不应销毁正在计算的Job。具体SSE实现、反压/关闭监听和重连cursor需在所锁Fastify版本实测；本文未核对第三方SSE插件，不指定未经验证的插件名。

## 2. pg复用现有SQL，不为迁TS重建第二份数据权威

官方事务接口是`pool.connect()`获得client，再用该**同一client**执行`BEGIN / SQL / COMMIT`，异常`ROLLBACK`，最后`client.release()`。不可在事务中混用`pool.query()`。现有表、唯一键、旧ID、内容hash与导入记录可以保持，替换的是Python数据库适配，不是另建平行数据库。依据[node-postgres事务](https://node-postgres.com/features/transactions)。

领域事务只包住短提交：校验attempt/revision/幂等键，保存Run索引/操作回执/领域状态/outbox。模型请求、PDF渲染、大尺度科学计算、沙箱运行全部在事务外做；不能让数据库连接和锁等模型数分钟。外部结果用冻结输入/attempt/fencing校验后提交，失败保留实际资源账。

## 3. pg-boss真实支持什么

本轮官网显示12.38.1，并读取同名tag的[package.json](https://github.com/timgit/pg-boss/blob/12.38.1/package.json)：声明Node>=22.12.0，MIT。**这是研究候选，不是项目已锁版本或已安装。**最终Node版本还须满足DSH SDK/runtime要求，不能只根据Fastify或队列要求选择。

`new PgBoss(config) → start() → createQueue(name) → send(name,data,options) → work(name,options,handler)`是官方公开路径。默认`work` handler收到jobs数组，不应抄旧单job回调假设。`send`在唯一/节流等策略下可能返回null，不能不检查返回值就发布任务已排队。见[官方Jobs](https://pgboss.io/api/jobs)和[Workers](https://pgboss.io/api/workers)。

### 与领域事务一起提交

`send()`等操作接受`{db}`；Db接口为`executeSql(text,values): Promise<{rows}>`，可以薄适配已有`pg`事务client。即：同一个client上BEGIN，写ResearchTask/Operation/outbox，`boss.send(queue,{taskId,attemptId},{db:txAdapter})`，再COMMIT。rollback应同时撤销领域记录与队列入队。不必为此引入ORM。官方也提供ORM adapters，但当前SQL已存在时不是强制需求。见[事务适配接口](https://pgboss.io/api/adapters)。

原有outbox仍可承担UI领域事件；队列入队和领域写已经同事务时，不应再让第二条outbox dispatcher无条件重复入队同一操作。若现架构必须用outbox入队，消费者使用稳定幂等键，并验证崩溃后重复投递；选择一条明确生产入队策略，而非两条同时生效。

12.38.1还支持`work(...,{transactional:true},async(jobs,tx)=>...)`，但官方明确handler期间一直持有事务连接，适合秒级处理；**不推荐用它包围DSH/科学长任务**。长任务先在事务外运行，末尾用短事务写领域结果，并在相同事务用`complete(...,{db})`结算；具体claim受理与返回affected检查按锁定版本验证。不要直接UPDATE pg-boss内部表或借队列状态充当产品ResearchTask。依据[Workers事务限制](https://pgboss.io/api/workers)。

### cancel绝不等于CPU或子进程已经停下

`cancel(name,id,options)`改变pending/active队列状态。12.38.1的[manager.ts](https://github.com/timgit/pg-boss/blob/12.38.1/src/manager.ts)中cancel调用SQL；运行handler的`job.signal`可在过期、关闭或心跳发现claim失效时abort。源码同样明确超时停止的是等待，忽略signal的handler仍可能继续运行。[worker.ts](https://github.com/timgit/pg-boss/blob/12.38.1/src/worker.ts)的abort是AbortController，不是强制终止JS执行。

所以产品取消流程应是：持久`cancel_requested`→向所属运行单元发abort→确认自己拥有的DSH/科学child/Worker退出→取消/结算队列claim并提交领域cancelled。不能收到`boss.cancel()`返回就告诉用户“计算已停止”。可传播signal给支持abort的网络调用；不合作CPU/WASM工作用可终止的专属执行单元。共享worker内不直接同步跑无限CPU，更不能为取消A杀掉B。

pg-boss当前fetched Job含`retryCount`，`complete/fail/cancel/touch`支持传fetched attempt，避免旧attempt结算新claim；这不覆盖应用自己的领域写，领域表仍须校验attempt/revision/fencing。生产锁版本后验证这一API，不能将本轮新版本行为外推到任意旧包。主要接口与限制见上述固定manager/worker及官方Jobs/Workers。

## 4. DSH TS SDK的生命周期并不等于产品任务生命周期

官方当前[TS SDK api.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/src/api.ts)有`new DeepSeekHarness(options)`、`start()`、`session(id).run(input,{onNotification})`、`resumeSession(id)`与`close()`/`await using`。运行时子进程由SDK对象拥有，必须确认close/清理成功，不能异常后盲起第二进程；客户端通知用于观测，正式操作完成仍以领域回执/Run为准。

该API的`RunOptions`未见通用AbortSignal或通用session/cancel。前轮固定commit `ce7073d51254c26cd63b22a60835b8f948deb447`协议也已确认此限制。**不能写一个不存在的SDK cancel接口。**首期每个有界Agent activation独占runtime与自己派出的科学执行单元；超时/取消先阻断新工具、保存已提交消息/回执，关闭并确认拥有进程退出。恢复读取领域未决操作与DSH持久session，不重复发送已受理prompt。

子进程close、超时停止等待、供应商停止计费、外部科学工作取消是四个不同结果。不得用“SDK已idle”替代后面三个；实际供应商中断能力和费用不明时如实记录。DSH SDK、runtime、plugin必须同一已验证版本组合，不把当前master示例和旧安装制品混用。

## 5. 只需先补的最小技术验证

1. **一个领域事务+一个队列Job。**同一pg client写操作/入队，分别commit与rollback；断进程后无“有领域任务却永不消费”或重复可见副作用。验证send返回null与同键异payload处理。
2. **一个真实DSH/Qwen activation。**调用现有Scientific Skill得真实Run、根据结果继续；同时抓无秘密的参数/回执关系、工具错误与实际退出。不能拿fixture代替真实provider。
3. **取消与claim竞争。**A计算中取消、B正常执行；故意让A handler忽略signal，证明supervisor确实终止专属单元，旧attempt晚结果不能提交。分别检查pg-boss状态、领域状态与OS进程。
4. **短提交窗口崩溃。**科学结果封存后、DB提交前、DB提交后丢回复，各做一次；恢复复用已提交回执，不重做Fork/费用/得分。长计算全过程不持有DB事务。

上述仅为建议验证，均未执行。结论是采用成熟Node HTTP/PG/队列适配并保留领域语义；不是靠换框架自动获得科学正确、任务恢复或产品体验。
