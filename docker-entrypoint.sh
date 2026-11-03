#!/bin/sh
set -e
umask 077
. /app/docker-workspace.sh
. /app/docker-authority.sh

# Docker 只负责托管管理服务，网关生命周期由管理服务统一维护。
if [ "$(id -u)" = "0" ]; then
  cd /app/development
  exec su-exec node:node env HOME=/home/node USER=node LOGNAME=node \
    node /app/packages/onebots/lib/bin.js "$@"
fi
cd /app/development
exec node /app/packages/onebots/lib/bin.js "$@"
