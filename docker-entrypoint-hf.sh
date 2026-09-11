#!/bin/sh
# HF 仅准备空工作区恢复；进程、安装和配对由常驻管理服务负责。
set -e
umask 077
export PORT="${PORT:-7860}"

if [ -L /data ]; then
  echo '[onebots] 错误: /data 不能是符号链接'
  exit 1
fi
mkdir -p /data
if [ "$(id -u)" != "0" ] && [ ! -w /data ]; then
  echo '[onebots] 错误: 当前容器用户无法写入 /data，请检查持久化存储权限'
  exit 1
fi

# 中断恢复不能被当作普通已有卷继续启动，更不能覆盖或自动重试。
RESTORE_PENDING=$(find /data -mindepth 1 -maxdepth 1 \( -name '.hf-restore-*' -o -name 'config.yaml.*.tmp' \) -print -quit)
if [ -n "$RESTORE_PENDING" ]; then
  echo '[onebots] 错误: 存在未完成的 HF 恢复，请保留卷并检查恢复结果，禁止自动重试'
  exit 1
fi

DATA_CONTENT=$(find /data -mindepth 1 -maxdepth 1 -print -quit)
if [ -n "${HF_REPO_ID:-}" ] && [ -z "$DATA_CONTENT" ]; then
  rm -f /tmp/data_backup.tar.gz
  if env -u ONEBOTS_BOOTSTRAP_CODE node /app/scripts/hf-repository-download.mjs data_backup.tar.gz; then
    # 已取得归档但验证/恢复失败时直接退出，不用另一份配置掩盖未知结果。
    env -u ONEBOTS_BOOTSTRAP_CODE node /app/scripts/hf-data-archive-restore.mjs
    rm -f /tmp/data_backup.tar.gz
    echo '[onebots] 已恢复可移植数据；扩展仍须在管理端重新安装和验证'
  else
    rm -f /tmp/data_backup.tar.gz
    if env -u ONEBOTS_BOOTSTRAP_CODE node /app/scripts/hf-repository-download.mjs config_backup.yaml; then
      echo '[onebots] 已恢复配置；可在管理端检查并安装所需扩展'
    else
      echo '[onebots] 未取得备份，启动空白管理工作区'
    fi
  fi
fi

# 不生成或改写业务 YAML，不从旧扩展目录执行代码，也不把 HF 下载凭据传给网关。
unset HF_TOKEN ONEBOTS_EXTENSION_ROOT ONEBOTS_EXTENSION_MODE NODE_PATH
if [ "$#" = 0 ]; then
  set -- serve --data-dir /data --host 0.0.0.0
fi
cd /app/development
if [ "$(id -u)" = "0" ]; then
  if ! chown -R node:node /data; then
    echo '[onebots] 错误: 无法将 /data 交给 node 用户，请检查持久化存储权限'
    exit 1
  fi
  exec su-exec node:node env HOME=/home/node USER=node LOGNAME=node \
    node /app/packages/onebots/lib/bin.js "$@"
fi
exec node /app/packages/onebots/lib/bin.js "$@"
