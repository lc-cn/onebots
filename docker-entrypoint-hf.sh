#!/bin/sh
# Hugging Face Spaces 入口：使用 PORT（默认 7860），并确保 config 中端口一致
set -e

# 从 development 目录启动，以便 require 能解析 workspace 的 node_modules（适配器、协议在此）
cd /app/development
# 便于排查：若 HF 报找不到适配器/协议，请清除 Space 构建缓存后重新部署，确保拉取到最新基础镜像
if [ ! -d node_modules ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
  echo "[onebots] 错误: /app/development/node_modules 不存在或为空，请使用最新的 ghcr.io/lc-cn/onebots 镜像并清除 HF 构建缓存后重试"
  exit 1
fi
export NODE_PATH="/app/development/node_modules"

mkdir -p /data
HF_PORT="${PORT:-7860}"

# 无持久化卷时从 Space 仓库恢复整个 data 或仅配置（免付费：备份在仓库的 data_backup.tar.gz / config_backup.yaml）
if [ ! -f /data/config.yaml ] && [ -n "${HF_REPO_ID}" ] && command -v curl >/dev/null 2>&1; then
  echo "[onebots] 尝试从 Space 仓库恢复: ${HF_REPO_ID}"
  # 优先恢复整个 data 目录（data_backup.tar.gz）
  if curl -sfL "https://huggingface.co/spaces/${HF_REPO_ID}/resolve/main/data_backup.tar.gz" -o /tmp/data_backup.tar.gz 2>/dev/null && [ -s /tmp/data_backup.tar.gz ]; then
    if command -v tar >/dev/null 2>&1; then
      tar -xzf /tmp/data_backup.tar.gz -C /data 2>/dev/null && echo "[onebots] 已从仓库恢复整个 data 目录 (data_backup.tar.gz)"
    fi
    rm -f /tmp/data_backup.tar.gz
  fi
  # 若未有完整备份，再尝试仅恢复配置文件
  if [ ! -f /data/config.yaml ]; then
    if curl -sfL "https://huggingface.co/spaces/${HF_REPO_ID}/resolve/main/config_backup.yaml" -o /data/config.yaml 2>/dev/null && [ -s /data/config.yaml ]; then
      echo "[onebots] 已从仓库恢复 config_backup.yaml 到 /data/config.yaml"
    else
      rm -f /data/config.yaml
    fi
  fi
fi

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

# onebots 通过 process.cwd()/node_modules 解析适配器，故必须在 development 下执行
exec node /app/packages/onebots/lib/bin.js "$@"
