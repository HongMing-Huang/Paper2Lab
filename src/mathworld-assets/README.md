# mathworld-assets — 数学游戏世界展示组件库

为 Paper2Lab 数学游戏（CLI-129 游戏窗口负责的动态游戏空间，及现有 Kakeya
三维场景）提供的**纯展示**轻量资产与组件。状态由游戏窗口以 props 传入；
本库不读不写任何游戏状态、数学参数、ExperimentRun、Goal、碰撞规则或
Agent 状态，装饰动画只是展示反馈，不冒充科学计算结果。

## 组件一览

| 组件 | 用途 | 关键 props |
| --- | --- | --- |
| `LabLights` | 暖白实验室灯光组（环境+暖主光+冷补光+轮廓光） | `intensity` |
| `LabEnvironment` | 本地 CC0 HDRI 环境反射（可选，Suspense） | `envMapIntensity` |
| `LabGround` | 有界实验台垫（默认）/大地面 + 细网格 + 接触阴影 | `mode`,`y`,`size`,`textureUrl` |
| `CubeFrame` | 单位立方参照框：边线+轴刻度+黄铜角点 | `size`,`origin` |
| `TargetZone` | 目标区标记（idle/active/ok/fail，active 呼吸、ok 涟漪） | `position`,`radius`,`state` |
| `SelectionRing` | 选中/悬停高亮环（selected=黄铜+慢旋转） | `position`,`radius`,`state` |
| `InkPath` | 尝试轨迹墨线（ok=蓝墨实线，fail=朱砂虚线，`faded` 保留旧尝试） | `points`,`state`,`faded` |
| `StatusGlow` | 对象上方状态光珠（computing 脉动/ok 蓝珠/fail 朱珠） | `position`,`state` |
| `StatusChip` | DOM 状态徽章（HUD 用，内联样式不依赖全局 CSS） | `state`,`label` |
| `labMaterial` | 材质预设对象（paperWhite/inkBlue/vermilion/brass/glass/rule） | spread 到 `meshStandardMaterial` |
| `palette` | 与 paper.css 对齐的色板常量（PAPER/INK/INK_BLUE/VERMILION/BRASS…） | — |

状态类型：`MathworldStatus = 'idle' | 'computing' | 'ok' | 'fail'`；
`TargetState` 另含 `'active'`；`SelectionState = 'none' | 'hover' | 'selected'`。

## 集成方式（游戏窗口 CLI-129）

1. **直接组合**：在游戏窗口自己的 R3F `<Canvas>` 内按需挂载，例如：

```tsx
import {
  LabLights, LabGround, CubeFrame, TargetZone, StatusGlow, InkPath,
} from '../mathworld-assets'

<Canvas gl={{ alpha: true }} camera={{ position: [1.55, 1.25, 1.55], fov: 38 }}>
  <LabLights />
  <Suspense fallback={null}>
    {/* textureUrl 省略则用零加载的纸面 fallback */}
    <LabGround textureUrl="/assets/mathworld-library/textures/plywood_diff_1k.jpg" />
    <LabEnvironment />
  </Suspense>
  <CubeFrame />                       {/* 默认与 TubesScene 的 [-0.5,0.5]³ 对齐 */}
  {/* 游戏窗口自己的 tubes/实体 */}
  <TargetZone position={landing} state={hit ? 'ok' : 'fail'} />
  <StatusGlow position={above} state={runStatus} />
  <InkPath points={attempt.traj} state={attempt.status} faded={!attempt.isLast} />
</Canvas>
```

2. **drei `View` 复用**：现有 `RunView3D` 的 View portal 结构不变，可把
   `CubeFrame`/`LabGround` 加进 `TubesScene` 同层（展示层，不动 tubes 数据）。
3. **HUD 徽章**：`<StatusChip state="ok" />` 可用于画布外的 DOM 布局；
   首次使用前调用一次 `injectMathworldAssetStyles()`（幂等）。
4. **资产路径**：一律 `/assets/mathworld-library/...`（vite public 约定）；
   来源/许可/体积见 `public/assets/mathworld-library/MANIFEST.md`。

### 边界（务必遵守）

- 只传展示 props 与状态枚举；不把 store、runtime、run 对象传进本库组件。
- 本库组件不得反向调用游戏写入接口（无任何 store/runtime import，构建期即可证）。
- `LabGround`/`CubeFrame` 不参与碰撞与判定；目标/选中/状态由游戏窗口判定后传入。

## 加载验证

预加载验证页（非产品界面）：

```bash
node src/mathworld-assets/preview/build-preview.mjs     # esbuild 自含 bundle
python3 -m http.server 8397 -d public --bind 127.0.0.1  # 任意静态服务
# 浏览器打开 http://127.0.0.1:8397/assets/mathworld-library/preview/index.html
```

2026-11-06 实测：Chrome 加载成功——HDRI/贴图 304 命中、台垫+网格+接触阴影、
立方框角点、active 目标呼吸环、ok/fail 墨线轨迹、四态 StatusChip、状态光珠
全部渲染；控制台仅 favicon 404（预览页无图标）与 three 内部 Clock 弃用警告。

## 验证状态

- `tsc -b`：`src/mathworld-assets/**` 0 错误（`server/node/**` 的既有错误属
  后端窗口活跃范围，与本库无关）。
- `npx vite build`：通过（9s，仅既有 chunk 体积提示）。
- 未写/未运行任何测试（本轮约束）；组件零 store/runtime 依赖即为隔离证据。
