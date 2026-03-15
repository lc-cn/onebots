#!/bin/sh
# Hugging Face Spaces 入口：使用 PORT（默认 7860），并确保 config 中端口一致
set -e

mkdir -p /data
HF_PORT="${PORT:-7860}"

if [ ! -f /data/config.yaml ]; then
  if [ -f /app/packages/onebots/lib/config.sample.yaml ]; then
    cp /app/packages/onebots/lib/config.sample.yaml /data/config.yaml
    echo "[onebots] 已创建默认配置 /data/config.yaml (Hugging Face)"
  else
    echo "[onebots] 错误: 未找到 config.sample.yaml"
    exit 1
  fi
fi

# 将配置文件中的 port 设为 HF 要求的端口（Spaces 只暴露该端口）
if command -v sed >/dev/null 2>&1; then
  sed -i "s/^port:.*/port: ${HF_PORT}/" /data/config.yaml 2>/dev/null || true
fi

exec node /app/packages/onebots/lib/bin.js "$@"
