#!/usr/bin/env bash
# 本地 Docker 构建并运行验证（需 OrbStack/Docker，且能访问 GitHub Packages）
# 使用：export NODE_AUTH_TOKEN="你的 PAT 或 GH_PKG_TOKEN" 后执行 ./scripts/docker-local.sh

set -e
cd "$(dirname "$0")/.."

if [ -z "${NODE_AUTH_TOKEN}" ] && [ -n "${GH_PKG_TOKEN}" ]; then
  export NODE_AUTH_TOKEN="${GH_PKG_TOKEN}"
fi
if [ -z "${NODE_AUTH_TOKEN}" ]; then
  echo "请设置 NODE_AUTH_TOKEN 或 GH_PKG_TOKEN（用于拉取 @icqqjs/icqq）"
  echo "例: export GH_PKG_TOKEN=ghp_xxx && ./scripts/docker-local.sh"
  exit 1
fi

echo "构建镜像（传入 NODE_AUTH_TOKEN 作为 build secret）..."
docker build --secret id=NODE_AUTH_TOKEN,env=NODE_AUTH_TOKEN -t onebots:local .

echo "运行容器（端口 6727，数据卷 ./data）..."
mkdir -p data
docker run --rm -it -p 6727:6727 -v "$(pwd)/data:/data" onebots:local
