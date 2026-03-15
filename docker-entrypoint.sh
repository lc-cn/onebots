#!/bin/sh
set -e

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

# 从 development 目录启动，以便 require 能解析 workspace 的 node_modules（适配器、协议在此）
cd /app/development
exec node /app/packages/onebots/lib/bin.js "$@"
