#!/usr/bin/env bash
# 本地 Docker 构建并运行空白管理服务（需 OrbStack/Docker）
# ICQQ 等扩展在容器启动后通过 CLI、TUI 或 Web 安装。

set -e
cd "$(dirname "$0")/.."

echo "构建空白管理镜像..."
docker build -t onebots:local .

echo "运行容器（端口 6727，数据卷 ./data）..."
mkdir -p data
docker run --rm -it -p 6727:6727 -v "$(pwd)/data:/data" onebots:local
