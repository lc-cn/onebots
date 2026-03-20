#!/bin/sh
set -e

# 持久化数据目录（配置、数据库、可选 static 校验文件等）
mkdir -p /data/static

# 若挂载的 /data 下没有 config.yaml，则从示例复制一份
if [ ! -f /data/config.yaml ]; then
  mkdir -p /data
  if [ -f /app/packages/onebots/lib/config.sample.yaml ]; then
    cp /app/packages/onebots/lib/config.sample.yaml /data/config.yaml
    echo "[onebots] 已创建默认配置 /data/config.yaml，可按需修改后重启容器"
  else
    echo "[onebots] 错误: 未找到 config.sample.yaml，请挂载包含 config.yaml 的卷到 /data"
    exit 1
  fi
fi

# 未显式传 -c/--config 时强制使用 /data/config.yaml，保证配置持久化在挂载卷内
HAS_CONFIG=0
for arg in "$@"; do
  if [ "$arg" = "-c" ] || [ "$arg" = "--config" ]; then
    HAS_CONFIG=1
    break
  fi
done
if [ "$HAS_CONFIG" = 0 ]; then
  set -- -c /data/config.yaml "$@"
fi

# 从 development 目录启动，以便 require 能解析 workspace 的 node_modules（适配器、协议在此）
cd /app/development
exec node /app/packages/onebots/lib/bin.js "$@"
