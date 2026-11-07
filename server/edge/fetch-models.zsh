#!/usr/bin/env zsh
# Intel 目标机模型准备脚本（CLI-151b · 端侧，不自动执行）。
#
# 用途：在拿到真实 Intel 测试机后，手动运行本脚本拉取官方 OpenVINO 制品并
# 启动 OVMS。模型制品全部来自 ModelScope（国内网络可达），每个都给出官方
# 仓库标识与许可；不使用 HuggingFace 直连。本脚本在开发机上一律不运行
# （无设备实测不声称就绪——AGENTS/Intel 边界）。
#
# 依赖（目标机自行安装）：
#   - OpenVINO Model Server (ovms) —— Intel 官方发布
#   - curl / unzip
#
# 用法（目标机）：
#   zsh server/edge/fetch-models.zsh <目标目录，如 /opt/paper2lab/models>
#
# 制品清单（与 config.example.json 的模型别名对应）：
#   | 别名      | 制品                                  | 来源（ModelScope，国内可达）                              | 许可     |
#   |-----------|---------------------------------------|-----------------------------------------------------------|----------|
#   | qwen3-0.6 | Qwen3-0.6B INT4 OpenVINO 导出版       | OpenVINO 官方账号下的 qwen3-0.6b-int4-ov 制品目录          | Apache-2.0 |
#
# 说明：INT4 量化制品由官方发布，适合 CPU/NPU 首验；不承诺承担复杂工具规划。
# 下载地址以 ModelScope 官方页面为准——若下述 URL 与官方仓库不符，以官方
# 仓库为准并在 PR 里修正本清单，不得换镜像站冒充官方制品。

set -euo pipefail

DEST="${1:-./models}"
ALIAS_DIR="$DEST/Qwen3-0.6B-int4-ov"

echo "目标目录: $DEST"
echo "制品: Qwen3-0.6B-int4-ov（OpenVINO 官方 INT4 导出，Apache-2.0）"
echo "来源: ModelScope OpenVINO 官方组织（国内网络可达）"

# ModelScope 文件下载基础路径（git 方式拉整个制品目录，与官方页面一致）
REPO="openvino/Qwen3-0.6B-int4-ov"

if [ -d "$ALIAS_DIR" ]; then
  echo "已存在 $ALIAS_DIR——跳过下载（删除后重跑可重新拉取）"
else
  mkdir -p "$DEST"
  # modelscope 官方 CLI（pip install modelscope）在国内网络可达；
  # 也可在浏览器直接下载官方页面列出的文件后放入该目录
  command -v modelscope >/dev/null 2>&1 || {
    echo "未安装 modelscope CLI：pip install modelscope 后重试，"
    echo "或在浏览器打开 https://modelscope.cn/models/$REPO 手动下载全部文件放入 $ALIAS_DIR"
    exit 3
  }
  modelscope download --model "$REPO" --local_dir "$ALIAS_DIR"
fi

echo
echo "下载完成。启动 OVMS（按目标设备改 --target_device）："
echo "  ovms --model_path $ALIAS_DIR --model_name qwen3-0.6 --rest_port 8000 --task text_generation --target_device CPU"
echo
echo "然后以 server/edge/config.example.json 启动适配："
echo "  PAPER2LAB_EDGE_CONFIG=server/edge/config.example.json \\"
echo "  PAPER2LAB_PAPER_BASE_URL=http://127.0.0.1:8788/ node --import tsx server/edge/main.ts"
echo
echo "注意：设备枚举走 GET /devices（官方 OpenVINO 绑定）；在真实设备上完成"
echo "推理记录之前，一切端侧能力保持 not_hardware_verified。"
