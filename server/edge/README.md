# Intel edge service

实际业务适配代码，复用已安装 Fastify 与 Node fetch；不新增 Python 推理框架或自制模型执行器。模型执行由官方 OpenVINO Model Server (OVMS) 承担。本轮仅完成源码和 TypeScript 编译检查，没有启动模型、下载模型或进行 CPU/GPU/NPU 测试。

## 启动

在 Intel 目标机安装官方 OVMS，并准备匹配目标设备的真实模型制品。CPU 首个小模型选官方启动示例中的 Qwen3-0.6B INT4 OpenVINO 制品；用于短文本辅助，不承诺它可靠承担数学 Agent 的复杂工具规划。

**模型拉取（目标机，国内网络）**：`zsh server/edge/fetch-models.zsh <目录>` 从 ModelScope 的 OpenVINO 官方组织拉取 `Qwen3-0.6B-int4-ov`（Apache-2.0），并打印 OVMS 启动命令。开发机不运行、不下载；制品清单与许可记录在脚本头部注释。

本地已有 `Qwen3-0.6B-int4-ov` 模型目录时，官方单模型服务命令形态：

```sh
ovms --model_path /absolute/path/Qwen3-0.6B-int4-ov --model_name qwen3-0.6 --rest_port 8000 --task text_generation --target_device CPU
```

然后在项目根目录：

```sh
PAPER2LAB_EDGE_CONFIG=server/edge/config.example.json \
PAPER2LAB_PAPER_BASE_URL=http://127.0.0.1:8787/ \
node --import tsx server/edge/main.ts
```

Paper URL必须指向真实Paper2Lab解析/文档服务；可改成现有8788。服务仅监听127.0.0.1:8792，`PAPER2LAB_EDGE_PORT`可改端口。`PAPER2LAB_EDGE_TOKEN`可保护全部端点；`PAPER2LAB_API_TOKEN`仅用于读取论文服务；`PAPER2LAB_OVMS_API_KEY`仅在上游有认证代理时使用。不输出密钥，不在配置JSON中存密钥。

## 真实接口

- `GET /health`：仅说明适配器存活和配置，不声称模型/设备就绪。
- `GET /capabilities`：配置的模型及设备路由；actualDevice为空。
- `GET /devices`：调用固定devices.py，使用官方OpenVINO Core.available_devices原生枚举；8秒超时，未安装返回503，不用配置列表冒充检测结果。PAPER2LAB_OPENVINO_PYTHON指定目标机Python。设备发现不证明某模型能在该设备推理。
- `POST /api/edge/chat`：messages、max_tokens（1–1024）、可选device。非流式真实OVMS调用，返回原模型输出及执行路由/降级记录。
- `POST /api/edge/embeddings`：input字符串或数组，可选device。返回真实向量；未配置模型时503，不造向量。
- `POST /api/edge/rerank`：query、documents，可选device。调用OVMS Cohere兼容rerank。
- `POST /api/edge/search`：docId、query、rerank:boolean、可选device。读取现有`/api/document/{docId}`解析内容，在原文item中检索；保留docId/anchorId/page/bbox。rerank=true时调用真实重排模型，不可用则报错，不假称已重排。纯词项检索不依赖LLM，不代表语义检索或跨论文搜索。

输入限制、上游超时、断线取消和响应大小限制均实际执行。生成文本是MODEL_OUTPUT，不是CALCULATED；不执行模型返回的工具或修改数学状态。embedding返回维度及索引校验，rerank索引只能映射回提交的原文候选。

## CPU/GPU/NPU与回退

每个device路由必须对应已经由运营者启动的OVMS服务，且该服务明确设置target_device。给routes添加GPU或NPU条目（不同baseUrl/模型别名），优先级由order控制。配置设备不等于原生设备发现，适配器不会从HTTP200推断NPU实际执行。

同一次无副作用推理最多尝试每个已配置设备一次；网络/HTTP/输出格式失败后按顺序回退。每条路由20秒、整次请求60秒限额。不会把科学工具或Agent操作放进这种推理重试。原始模型错误不透传敏感响应体。当前结果actualDevice=null，设备性能与实际执行设备须到目标机用OVMS/OpenVINO运行时确认。

NPU模型制品与驱动需独立准备；不能把CPU的INT4文件不加验证地宣称支持NPU。GPU/NPU参数和模型支持按下面官方文档核对。现有ARM Mac不证明Intel设备兼容。

### 多设备启动样例（NPU > GPU > CPU 回退）

每个设备一个独立 OVMS 实例（不同 `--rest_port` 与 `--target_device`），只启动实际要用的设备；单设备场景只需 CPU 那一行：

```sh
# CPU（fetch-models.zsh 拉取的官方 INT4 导出）
ovms --model_path /opt/paper2lab/models/Qwen3-0.6B-int4-ov --model_name qwen3-0.6     --rest_port 8000 --task text_generation --target_device CPU
# GPU（Intel 核显；同一官方导出按官方文档核对 GPU 支持后再启动）
ovms --model_path /opt/paper2lab/models/Qwen3-0.6B-int4-ov --model_name qwen3-0.6-gpu --rest_port 8001 --task text_generation --target_device GPU
# NPU：制品名与参数以官方 NPU demo 为准（ovms_demos_llm_npu.html），本仓库脚本拉取的
# INT4 导出不预先宣称可在 NPU 运行；官方确认制品后按同一形态启动：
# ovms --model_path <NPU制品目录> --model_name qwen3-0.6-npu --rest_port 8002 --task text_generation --target_device NPU
```

对应适配器配置见 `config.multi-device.example.json`（order 为 NPU > GPU > CPU）。启动适配器：

```sh
PAPER2LAB_EDGE_CONFIG=server/edge/config.multi-device.example.json \
PAPER2LAB_PAPER_BASE_URL=http://127.0.0.1:8788/ node --import tsx server/edge/main.ts
```

调用时可带 `"device": "GPU"`（或 `"NPU"`/`"CPU"`）把该设备排到本次尝试最前；未带则按 order。每次成功响应的 `inference.configuredDevice` 标明走了哪条配置路由，`fallback` 数组记录此前失败的设备与原因；`actualDevice` 保持 null 直到目标机实测。`GET /capabilities` 会列出全部已配置路由及 `verification: "not_hardware_verified"`。

## 接入边界与剩余工作

已接现有论文文档读取端点。前端与DSH目前未自动接入此独立服务；DSH如使用OVMS OpenAI协议应配置实际OVMS `/v3/` provider端点，不能把本适配器带metadata的响应误当OpenAI协议。尚未完成：目标机模型启动/质量和性能、设备枚举实机验证、embedding索引入库、跨论文检索、DSH provider/profile正式连接。

官方依据：
- https://docs.openvino.ai/2026/model-server/ovms_docs_serving_model.html
- https://docs.openvino.ai/2026/model-server/ovms_docs_server_app.html
- https://docs.openvino.ai/2026/model-server/ovms_docs_genai.html
- https://docs.openvino.ai/2026/model-server/ovms_demos_llm_npu.html

设备枚举可单独准备Python环境并安装官方文档对应openvino==2026.4.0（并非核心产品Python前置），然后设置PAPER2LAB_OPENVINO_PYTHON为该环境解释器。此薄探针只使用官方绑定，不实现推理后端；该版本在目标机的驱动兼容仍待你验证。

Windows PowerShell启动适配器（OVMS为独立进程，先按上面准备模型）：

```powershell
$env:PAPER2LAB_EDGE_CONFIG = "server/edge/config.example.json"
$env:PAPER2LAB_PAPER_BASE_URL = "http://127.0.0.1:8788/"
$env:PAPER2LAB_OPENVINO_PYTHON = "C:\path\to\openvino-env\Scripts\python.exe"
node --import tsx server/edge/main.ts
```
