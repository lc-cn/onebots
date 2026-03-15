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

# 启动网关（前台）：传递所有参数给 onebots CLI
exec node /app/packages/onebots/lib/bin.js "$@"
