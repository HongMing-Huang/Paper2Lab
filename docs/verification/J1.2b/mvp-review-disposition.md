# MVP 冻结切片独立复核与处置 — 2026-11-07（ZCode 主会话）

复核：只读 Explore 子代理（全量读冻结文件 + 真实内核只读数值验证）。结论：**无 blocker，可进集成复验**；4 major、7 minor、6 note。

## Major 处置（全部已修）

| ID | 发现 | 处置 | 验证 |
|---|---|---|---|
| M1 | TubeMesh/CurveHandle/InitialPointHandle 缺 pointercancel——触屏打断后 drag 悬挂、相机锁死、漂移 preview 会被下一次 up 提交扣预算 | 三处 mesh 统一补 `onPointerCancel`：结束拖拽+释放相机锁+`host.endPreview()`（不提交） | tsc/build 绿；cancel 路径复用 end 的清理逻辑 |
| M2 | importSave 'local' 通道不备份——激活阶段开局 autosave 先覆盖原键，恢复重算失败=本机进度永久丢失 | 备份移出 `via==='file'` 条件，两通道都先写 `${key}.backup` | 浏览器实测 backupExists=true（file 通道）；逻辑审查两通道同一顺序 |
| M3 | experiment.fork 对 kakeya.measure 丢 length+offsets——fork 出的是经典单位管族而非同族克隆，血缘断裂 | inputFromSpec 携带 `model.length`（≠1 时）与 `model.offsets`（非空时） | 真实内核实测：fork 子 Run `model.length=0.7`、`offsets` 12 条完整保留 |
| M4 | 多条 kakeya-volume 只判第一条，第二条静默漏判（手工 JSON 可造） | validateKakeya 拒绝非恰好 1 条（错误信息解释原因） | 负例：2 条约束 → 明确错误；两 shipped 关仍 OK |

## Minor 处置

- **m1**（dragCluster 钳制→toFixed(4) 顺序致墙面不可达/误报越出）：改 round-then-clamp。回归实测：全部轴推到 max-1e-3 边界 preview ok=true。
- **m2**（undo 乒乓：恢复"刚离开的状态"）：AttemptRecord 增 `fromUndo` 标记（undo 历史过滤排除）+ 连续 undo 走"最近的不同状态"。实测：undo1→见证态(0.0308)，undo2→不同状态(0.0000, different=true)。
- **m3**（StatusGlow/SelectionRing 用立方体坐标当世界坐标）：改 `toWorld()` 换算。
- **m6**（importSave 只裁定 won 不裁定 lost）：lost 声称与重算 success 矛盾时同样回 playing 并明示。
- **m7**（回放模式无交互围栏）：preview()/commit() 入口 `exitReplayIfActive()`——任何真实交互先退出回放，状态不会在"只读回放画面"背后被改。

## 登记未修（如实，非阻断）

- **m4** 三处"半径过细 unknown"阈值文案不一致（实判 2δ·res<0.5；shipped 关 2δ·res=8 远不触发）
- **m5** kakeya.measure 非法 length 静默回退 1（run 记录自洽、Goal 复绑可识破，契约卫生）
- **n1** kakeyaTubes throw 时回放整族消失（仅 fromFile 未重校验参数可触发）；**n2** 死默认/注释；**n3** unknown→idle 色不一致；**n4** superseded 不清 preview（极窄窗口）；**n5** backup 单槽位；**n6** 防刷分核心零测试覆盖（本轮约束不写测试）

## 复核确认的关键正面结论

- 计分链无刷分/伪造/静默放行通路；applyOffsets/kakeyaClusterBox/checkPatch 三处边界算术逐位一致（8/8 角点零拒绝）
- readMeasure offsets JSON 复绑两侧同源构造、key 顺序固定（实测 jsonSame=true）
- activationEpoch 覆盖全部 5 个 await 恢复点；activate 中途 commit 被 generation+sessionId 双闸判 superseded
- 两 shipped 关正式分辨率下编辑器同款 witness 策略实算均可解（余量 0.246pp/0.381pp ≫ tiny/convTol）
- CLI-148 组件纯展示边界保持；__mathworld 桥无第二特权路径

## 处置后验证

tsc exit 0；vite build（mathworld + 主应用）过；浏览器回归：边界 preview ok / fail→win / undo 不乒乓 / replay 正常。
