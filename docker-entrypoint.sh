#!/bin/sh
set -e
umask 077

# Docker 只负责托管管理服务，网关生命周期由管理服务统一维护。
mkdir -p /data
if [ "$(id -u)" = "0" ]; then
  if ! chown -R node:node /data; then
    echo '[onebots] 错误: 无法将 /data 交给 node 用户，请检查挂载卷权限'
    exit 1
  fi
  cd /app/development
  exec su-exec node:node env HOME=/home/node USER=node LOGNAME=node \
    node /app/packages/onebots/lib/bin.js "$@"
fi
if [ ! -w /data ]; then
  echo '[onebots] 错误: 当前容器用户无法写入 /data，请检查挂载卷权限'
  exit 1
fi
cd /app/development
exec node /app/packages/onebots/lib/bin.js "$@"
