#!/bin/sh
# HF 兼容入口；自动恢复尚未接入受控来源登记，首期明确禁用。
set -e
umask 077
if [ -n "${HF_REPO_ID:-}" ]; then
  echo '[onebots] 错误: 首期禁用 HF_REPO_ID 自动恢复；未下载或修改工作区与身份目录，请移除此变量。受控恢复后续补齐'
  exit 1
fi
. /app/docker-workspace.sh
. /app/docker-authority.sh
export PORT="${PORT:-7860}"

# 中断恢复不能被当作普通已有卷继续启动，更不能覆盖或自动重试。
RESTORE_PENDING=$(find /data -mindepth 1 -maxdepth 1 \( -name '.hf-restore-*' -o -name 'config.yaml.*.tmp' \) -print -quit)
if [ -n "$RESTORE_PENDING" ]; then
  echo '[onebots] 错误: 存在未完成的 HF 恢复，请保留卷并检查恢复结果，禁止自动重试'
  exit 1
fi

# 不生成或改写业务 YAML，不从旧扩展目录执行代码，也不把 HF 下载凭据传给网关。
unset HF_TOKEN ONEBOTS_EXTENSION_ROOT ONEBOTS_EXTENSION_MODE NODE_PATH
if [ "$#" = 0 ]; then
  set -- serve --data-dir /data --authority-dir /var/lib/onebots-authority/authority --host 0.0.0.0
fi
cd /app/development
if [ "$(id -u)" = "0" ]; then
  exec su-exec node:node env HOME=/home/node USER=node LOGNAME=node \
    node /app/packages/onebots/lib/bin.js "$@"
fi
exec node /app/packages/onebots/lib/bin.js "$@"
