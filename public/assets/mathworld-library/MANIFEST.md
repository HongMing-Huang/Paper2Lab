# mathworld-library 资产清单（MANIFEST）

数学游戏世界的外部成熟资产库。只收录**来源明确、许可宽松、体积轻量**的资产；
每个文件在此登记来源 URL、许可、原始版本、SHA-256 与实际体积。
许可原文核验方式见每条目的"许可依据"。

## 资产

### hdri/studio_small_03_1k.hdr

| 项 | 值 |
| --- | --- |
| 名称 | Studio Small 03 (1k HDR) |
| 用途 | `LabEnvironment` 的环境反射/IBL（`background={false}`，只提供 envMap） |
| 来源 | https://polyhaven.com/a/studio_small_03 （文件直链 `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr`） |
| 作者 | Greg Zaal（Poly Haven API `info` 端点） |
| 发布日期 | 2018-04-02 |
| 许可 | **CC0 1.0（公有领域）**。依据：Poly Haven 全站资产统一以 CC0 发布（站内 Licensing 页声明）；API `info.studio_small_03` 返回作者与发布信息 |
| 原始版本 | 下载于 2026-11-06，1k HDR 版（未修改） |
| 体积 | 1,686,299 字节（1.61 MiB） |
| SHA-256 | `30933d55e45f0795daf49f3cbefbe0e5ebcb821ee04fb0a2818c02ffc3938817` |
| 实际加载验证 | ✅ Chrome 经静态服务 304 命中，场景正常渲染（见 preview/） |

### textures/plywood_diff_1k.jpg

| 项 | 值 |
| --- | --- |
| 名称 | Plywood — diffuse only（1k JPG） |
| 用途 | `LabGround` 实验台垫/地面漫反射贴图（`SRGBColorSpace`，repeat 平铺） |
| 来源 | https://polyhaven.com/a/plywood （文件直链 `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plywood/plywood_diff_1k.jpg`） |
| 作者 | Rob Tuytel（Poly Haven API `info` 端点） |
| 发布日期 | 2020-06-22 |
| 许可 | **CC0 1.0（公有领域）**。依据同上（Poly Haven 全站 CC0） |
| 原始版本 | 下载于 2026-11-06，1k diffuse 版（未修改；未引入 normal/roughness 贴图以保持轻量） |
| 体积 | 882,059 字节（861 KiB） |
| SHA-256 | `800905650fc6cab2fe7c77c41851f8ea89669f1287ad5ce67c48f435654c0af8` |
| 实际加载验证 | ✅ Chrome 经静态服务 304 命中，sRGB 修正后台垫色彩正确 |

## 本库自建内容

- `preview/index.html`、`preview/bundle.js` — 加载验证页与其自含 bundle（由
  `src/mathworld-assets/preview/build-preview.mjs` 用仓库内 esbuild 生成），
  非产品界面，可随时重建/删除。bundle 内打包 react/three/R3F/drei 及本库组件。
- `src/mathworld-assets/**` 组件与示例数据为本项目原创代码，无第三方许可约束
  （随仓库许可）。组件内未引用任何需署名或同源传染的资产。

## 引用规则

- 组件内引用资产一律走 `/assets/mathworld-library/...` 绝对 URL（vite 与任意
  静态服务下同样成立），不得复制资产到其他目录。
- 新增第三方资产前：确认许可允许再分发、登记本清单（来源/许可/版本/体积/
  SHA-256），并保持单文件 ≤ 2 MiB（贴图）/ ≤ 3 MiB（环境）量级。
- 不收录 GPL/CC-BY-NC 等对再分发或用途有限制的资产。
