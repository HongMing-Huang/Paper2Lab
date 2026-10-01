# Paper2Lab 技术调研（v3 汇总）

> 方法：v1 四路调研（xyflow/marimo/R3F/Plot+MathLive+pdf.js，官方文档+源码）；v3 四路调研（**实际克隆仓库读源码**，非 README）。kakeya-explainer 的 C++ 被**实际编译运行并复现其数字**。克隆位置：`~/Desktop/paper2lab-research/`。

## 结论速览（怎么用进 Paper2Lab）

| 项目 | 关键结论 | 在 Paper2Lab 中的用法 |
|---|---|---|
| xyflow/xyflow | @xyflow/react 12.12，MIT；nodrag/nowheel/nopan；Background dots；fitView 聚焦；节点内 WebGL 需 eventPrefix="client" | 无限画布底座（Lab Canvas） |
| marimo | 单一所有权 + 依赖先注册 ⇒ DAG by construction；拓扑序失效；stale-while-recompute；UI 元素只写 cell | Reactive Runtime 思想（自研 ~200 行，未嵌入 marimo） |
| pyodide | npm 打包在 Vite 下 `loadPackage('numpy')` 失败（wheel 完整性）；官方推荐 CDN indexURL；v0.27.7 | PythonScientificRuntime（下一篇论文），CDN 懒加载进独立 worker |
| GoogleChromeLabs/comlink | 4.4.2 Apache-2.0 ~1.2kB；expose/wrap；`import type` 导入 API 类型；TypedArray 用 Comlink.transfer | voxel worker RPC（measureVoxelCover/measureFamily） |
| react-three-fiber | fiber 9.8 要求 react ≥19 <19.4；InstancedMesh+dummy 矩阵；quaternion Y→dir | 3D δ-tubes / Microscope Mode |
| observablehq/plot | 0.6.17；recreate-on-data-change；`plot.on(type, {channel}, listener)` 反向导航 | scaling 曲线 + 直方图 + 点→实验导航 |
| arnog/mathlive | 0.110（注意 0.x 版本号！）；static.css+fonts.css；convertLatexToMarkup | 公式渲染 + 可编辑沙盒 |
| mozilla/pdf.js | 4.10 ESM `?url` worker；convertToViewportRectangle；文本项间多空格；arXiv 有封面页（定理在 p.3） | Source Drawer 定位高亮 |
| bojieli/kakeya-explainer | 单尺度 δ、van der Corput 方向；DDA+精确段-盒距离；atomic bitmap 只算 occupied；C++ -O3 -pthread 实测 δ=1/1000=456,958,817/3.375B（1.03s），δ=1/10000 需 422GB ⇒ 必须预计算 | C++ 预计算配方（我们升级为 uint16 multiplicity 计数 + JSON 直出 + checksum，避免其手工粘贴 TSV） |
| SKR-35/Kakeya-Needle-Lab | Tkinter/PIL；运动参数化+无状态轨迹重采样好；**其 Perron 树是装饰性扇形（无细分/平移/面积验证）** | 借鉴：path 为单一真源、密度热图；我们的 Perron 是真构造（面积递减有单测） |
| mlc-ai/web-llm | v0.2.85 WebGPU；语法约束 JSON 模式（结构化输出首选） | 未来本地 Agent 的 planner 替换（非 P0） |
| huggingface/transformers.js | v4.3；JSON 无语法约束，需自行修复 | 备选，不选 |

## 关键源码级细节（择要）

### bojieli/kakeya-explainer（读 `scripts/precompute_counts.cpp`、`app.js`）
- 计数：3D DDA（Amanatides–Woo）ray-march + 3³ 邻域候选 + **解析精确段-盒距离**（分段二次闭式）；浏览器路径用 18 步三分搜索（较慢，我们不用）。
- 线程模型：min(8, hw) 管道分片；64-bit 字位图 `__atomic_fetch_or`；只表达 occupied，不能 multiplicity ⇒ 我们改用 `std::atomic<uint16_t>` 计数器。
- 输出 TSV→手工粘贴进 JS（无 checksum）⇒ 我们 JSON 直出 + FNV-1a + algorithmVersion。

### comlink（读 `src/comlink.ts` + docs/examples）
- `Comlink.expose(api)` / `Comlink.wrap<Api>(worker)`；主线程用 `import type { api } from './worker'`（编译期擦除，不把 worker 拉进主包）。
- 返回 TypedArray 用 `Comlink.transfer(out, [out.buffer])` 零拷贝；回调用 `Comlink.proxy(cb)`。
- releaseProxy 只释放代理不终止线程，需 worker.terminate()。

### Kakeya-Needle-Lab（读 `motion/*`、`constructions/perron.py`、`raster.py`）
- 好：`MotionFrame(path_deg)` 参数化 + 每帧全路径重采样（无状态轨迹，scrub 不失同步）；np.add.at 密度栅格 + 99.5 分位归一。
- 差（反面教材）：Perron 三角形是手调扇形——**没有** 2^k 细分、没有平移合并、没有面积验证；"coverage 100%" 是硬编码字符串。我们的实现以 Wigderson/Chang 讲义的合并引理为准并有单调性单测。

### marimo（读 `marimo/_ast/visitor.py`、`_runtime/dataflow/{graph,edges,cycles}.py`、`_runtime/runner/{cell_runner,scheduler}.py`、`_runtime/runtime.py`）
- **图推导**：`ScopedVisitor`（visitor.py:234）静态抽取 defs/refs/del-refs；cell 局部名加 `_{cell_id}x` mangling（L316–325）。edges.py:118–262：def→引用者为 child、ref→定义者为 parent、del→引用者的 child。
- **stale/拓扑/环/禁用**：cycles.py:32–56 逐新边检测环（get_path）；graph.py:296–310 set_stale=后代传递闭包；dataflow/__init__.py:96–131 Kahn+堆（注册序破并列）；cell_runner.py:232–273 计算 roots∪stale 祖先−错误 cell 再拓扑排序；scheduler.py:121–147 重排队按拓扑序、取消级联到后代。禁用 cell 的后代标记 disabled-transitively。
- **UI 绑定**：runtime.py:1932–2117 set_ui_element_value → `component._update(value)` 后走普通名字图重跑 **引用者**，创建者 cell 永不重触发（自环抑制）——与我们的 ParamSlider/ParamChip 只写 param 不触发自身渲染等价。
- **无隐藏状态**：cell 编译为函数（compiler.py:257+）、临时名运行后弹出（hooks_post_execution.py:511–527）、重跑前 `_invalidate_cell_state` 清 defs/UI。
- **与我们 TS runtime 的对照**：拓扑失效（stale 闭包+Kahn）**同构** ✓；差异：marimo 用单 FIFO SequentialScheduler 串行保正确，我们用 **generation 计数防乱序提交**（异步原生等价物）；marimo 的"UI 写值不触发创建 cell"对应我们"setParam 不触发 param cell 自身重算"。

### web-llm / transformers.js（README+docs）
- web-llm：`CreateMLCEngine` + `response_format` 语法约束 JSON；1–4B q4 是笔记本甜点；首载 0.5–5GB。
- transformers.js：无语法约束解码，JSON 需 zod+jsonrepair 兜底。⇒ 未来 Agent 选 web-llm。

## 对 v3 架构的直接决定

1. **Kakeya 路径禁 Pyodide**：TS kernel + Comlink worker（延迟最低）；preview(res32 同步)→exact(res48-64 worker) 双层。
2. **C++ 预计算**：`scripts/precompute_kakeya.cpp`（-O3 -pthread，uint16 multiplicity，JSON+checksum）——已编译运行：27 行 / 1.3s / 223% CPU，packing=1 ⇒ maxM=N 精确复现。
3. **PythonScientificRuntime**：Comlink + CDN Pyodide 独立 worker（numpy/scipy、solveIVP 接口），接口先行不进 Kakeya 路径。
4. **Agent**：本地确定性 planner 输出结构化 Action 列表；未来可被 web-llm（语法约束 JSON）替换，Action 形状不变。
