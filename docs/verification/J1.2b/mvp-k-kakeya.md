# CLI-149（MVP-K Kakeya 世界适配）开发交付 — 2026-11-07

owner：ZCode 主会话（协调者；game owner 窗口自 00:52 起无写入，按 CLI-151"协调者冻结接口后重新划分"路径接管本切片，范围与 129 重叠文件全部由本会话单写者串行修改）。**状态：开发完成，浏览器实操被共享浏览器抢占中断（见下），未签 Done。**

## 交付（身份见下方 sha256 前 12 位）

**内核层（共享文件，集成 owner 串行）**
- `src/kakeya/tubes.ts`（2e21bd97…）：`Tube3.length`（默认 1，经典实验逐字节不变）；`makeTubes` 对可玩族（length<1）在含 δ 的收缩盒内生成本局布局；`centerBoxOf`/`applyOffsets`——**计分域 [0,1]³ 整胶囊包含**：越出即 throw，不能移出测量盒刷体积。
- `src/kakeya/voxels3d.ts`（2455c4b9…）：测量环按 `t.length` 截断；analyticPerTube 按 πδ²L。
- `src/skills/registry.ts`（1948207f…）+ `executor.ts`（e1123afd…）：kakeya.measure 输入增 `offsets`（每管一个 {x,y,z}，与管数严格一致）与 `length`（0<len≤1）；两者入 `spec.model` 血缘（Goal 据此复绑）。

**MathWorld 层（CLI-129 交付文件的最薄增量）**
- `definition.ts`（bd986e22…）：`KakeyaModel`（deltaExp/nTubes/length/packing/res/refineRes/clusters）、`KakeyaClusterDecl`（operable=false 即固定簇）、`ClusterDragDecl`、`KakeyaVolumeConstraint`（maxVolume+convTol）。
- `validate.ts`（0bb88daa…）：完整 Kakeya 世界校验——**2δ+length≤1**（否则轴向管放不进计分域）、簇索引不重不越界、声明布局必须合法（applyOffsets 实测）、控制只绑可动簇、约束只收 kakeya-volume、δ·res<0.5 给 warning（正式计分将 unknown）。
- `kernels.ts`（7587fbee…）：`kakeyaTubes`/`kakeyaPreview`（与正式同链 fib→makeTubes→applyOffsets→computeVoxelCoverage，预览仅 res=22 不计分）/`kakeyaClusterBox`（簇位移合法盒=成员盒交集）/`kakeyaOffsetArray`。
- `goal.ts`（7b0649c5…）：`KakeyaEvidence`；`readMeasure` 复绑 deltaExp/nTubes/packing/length/res/**全 offsets**（布局不符=证据无效）；判定：2δ·res<0.5→unknown（管比体素细不计分）；res vs refineRes 差>convTol→unknown（粗网格不侥幸）；贴界（≤1e-4）→unknown；V>max→fail（附"还差几个百分点"与操作提示）；V≤max→pass（明示有限尺度估计）。
- `host.ts`（e64f4659…）：kakeya 分支（activate 注册 kakeya.measure PlayPlan、preview 同链粗算、commit 正式 res+refineRes 双 Run、`dragCluster` 相机面增量→合法盒钳制、tunables=每可动簇 x/y/z 三旋钮）。
- `App.tsx`（ecbd00ee…）：δ/N 公式卡+预览体积徽章、固定簇芯片、kakeya 约束文案、拖簇提示。
- `scene/WorldScene.tsx`（153b163a…）：`KakeyaRoom`（计分立方体线框+背面、簇色管渲染、`TubeMesh` 相机面拖拽/悬停/选中发光、松手 commitPreview、越界诊断浮签）。

**关卡（公开资产）**
- `kakeya-room-basic.json`（279f8310…）：12 管/3 空间连贯簇（2 动 1 固），目标 ≤9.8%。
- `kakeya-room-sticky.json`（88787cf…）：16 管/4 簇（3 动 1 固"粘性芯"），目标 ≤12.3%。
- `kakeya-calib.mts`（7bb57df4…）：标定探针（只读内核，无文件写），**正式内核（res64+res96）实测**：basic 开局 0.1046→见证偏移 0.0955/0.0955；sticky 开局 0.1322→0.1192/0.1192。目标值据此设定：开局必 fail、见证必 pass、双分辨率差 0.0000<convTol 0.01。

## 验证状态

- `validateWorld`：两份世界 OK。
- 根 `tsc --noEmit`：exit 0（7 处旧错误已在 MVP-A 修复，本轮新增 0）。
- `vite build --config vite.mathworld.config.ts`：通过。
- 正式内核链（Node 直调 executeSkill+PlayPlan）：开局/收拢/越界拒绝三点全测——越界布局在 Run 创建前被拒（"第 i 根管的胶囊会越出计分域…拒绝"）。
- 浏览器（127.0.0.1:5192 独立端口）：页面加载、世界切换到 kakeya-room-basic、开局观察与目标卡渲染、约束/规则文案显示（evaluate 读 DOM 证实）。**完整"失败→拖动→成功"实操被共享 Playwright 浏览器的并行会话抢占中断（导航被改、后整个浏览器被关闭）**——未完成，未签收。

## 有界候选搜索（任务步骤 3）

标定探针已实现等价搜索（簇均值指向固定簇、合法盒钳制、正式双分辨率复核）；作为独立"验证器"API 入 host/页面尚未做——列入未完成。

## 未完成

- 浏览器完整实操序列（失败→拖簇→正式达标→切 sticky→保存/恢复）。
- host 级"发布前有界搜索见证/unknown 不发布"API。
- CLI-130/131/112/150（原 game owner 顺序路径）。
