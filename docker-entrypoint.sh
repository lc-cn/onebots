#!/bin/sh
set -e

# 新建配置、数据库与日志默认仅允许容器运行用户访问。
umask 077

# 显式 --user 启动时无法代为迁移卷属主，应在首次写入前报告权限问题。
if [ "$(id -u)" != "0" ] && [ ! -w /data ]; then
  echo "[onebots] 错误: 当前容器用户无法写入 /data，请检查挂载卷权限"
  exit 1
fi

# 持久化数据目录（配置、数据库、可选 static 校验文件等）
mkdir -p /data/static

# 若挂载的 /data 下没有 config.yaml，则从示例复制一份
if [ ! -f /data/config.yaml ]; then
  mkdir -p /data
  if [ -f /app/packages/onebots/lib/config.sample.yaml ]; then
    cp /app/packages/onebots/lib/config.sample.yaml /data/config.yaml
    if ! chmod 600 /data/config.yaml; then
      echo "[onebots] 错误: 无法将新配置权限收紧为 0600: /data/config.yaml"
      exit 1
    fi
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

# root 只负责初始化挂载卷；长期运行的网关降权到镜像内置 node 用户（uid/gid 1000）。
# 递归迁移已有卷，确保旧版 root 容器创建的数据库、日志与配置仍可继续写入。
if [ "$(id -u)" = "0" ]; then
  if ! chown -R node:node /data; then
    echo "[onebots] 错误: 无法将 /data 交给 node 用户，请检查挂载卷权限"
    exit 1
  fi
  exec su-exec node:node env HOME=/home/node USER=node LOGNAME=node \
    node /app/packages/onebots/lib/bin.js "$@"
fi

# 显式 --user 启动时尊重调用方身份，并在启动前给出清晰的卷权限错误。
if [ ! -r /data/config.yaml ] || [ ! -w /data ]; then
  echo "[onebots] 错误: 当前容器用户无法读取 /data/config.yaml 或写入 /data"
  exit 1
fi
exec node /app/packages/onebots/lib/bin.js "$@"
