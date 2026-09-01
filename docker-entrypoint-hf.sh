#!/bin/sh
# Hugging Face Spaces 入口：使用 PORT（默认 7860），并确保 config 中端口一致
set -e

# 下载与恢复内容可能包含平台凭据；新建文件默认仅允许容器运行用户访问。
umask 077
echo "[onebots] 入口脚本执行中 (Hugging Face) ..."

if [ "$(id -u)" != "0" ] && [ ! -w /data ]; then
  echo "[onebots] 错误: 当前容器用户无法写入 /data，请检查持久化存储权限"
  exit 1
fi

# 镜像内置依赖仍位于 development；持久化扩展根会在下载恢复完成后准备。
cd /app/development
# 便于排查：若 HF 报找不到适配器/协议，请清除 Space 构建缓存后重新部署，确保拉取到最新基础镜像
if [ ! -d node_modules ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
  echo "[onebots] 错误: /app/development/node_modules 不存在或为空，请使用最新的 ghcr.io/lc-cn/onebots 镜像并清除 HF 构建缓存后重试"
  exit 1
fi

mkdir -p /data
mkdir -p /data/static
HF_PORT="${PORT:-7860}"

# 使用公共 DNS，避免 HF 等环境中容器内 DNS 不可达导致 api.telegram.org、discord.com 等 ENOTFOUND
if [ -w /etc/resolv.conf ] 2>/dev/null; then
  printf 'nameserver 8.8.8.8\nnameserver 1.1.1.1\n' > /etc/resolv.conf
  echo "[onebots] 已设置 DNS 为 8.8.8.8 / 1.1.1.1（便于解析 Telegram、Discord 等外部 API）"
fi

# 无持久化卷时从 Space 仓库恢复整个 data 或仅配置（免付费：备份在仓库的 data_backup.tar.gz / config_backup.yaml）
# 只要设置了 HF_REPO_ID 就尝试恢复，不依赖本地是否已有 config（否则重启后本地有残留就不会拉备份）
if command -v curl >/dev/null 2>&1; then
  if [ -z "${HF_REPO_ID}" ]; then
    echo "[onebots] 未设置 HF_REPO_ID，跳过从仓库恢复（请在 Space → Settings → Variables 中添加 HF_REPO_ID，如 用户名/Space名）"
  else
    echo "[onebots] 尝试从 Space 仓库恢复: ${HF_REPO_ID}"
    _hf_url_tar="https://huggingface.co/spaces/${HF_REPO_ID}/resolve/main/data_backup.tar.gz"
    _hf_url_yaml="https://huggingface.co/spaces/${HF_REPO_ID}/resolve/main/config_backup.yaml"
    _hf_url_extensions="https://huggingface.co/spaces/${HF_REPO_ID}/resolve/main/extensions_backup.json"
    # 私有仓库需在 Secrets 中设置 HF_TOKEN
    if [ -n "${HF_TOKEN}" ]; then
      _curl_auth="-H"
      _curl_auth_val="Authorization: Bearer ${HF_TOKEN}"
    else
      _curl_auth=""
      _curl_auth_val=""
    fi
    # 优先恢复整个 data 目录（data_backup.tar.gz）
    if [ -n "${_curl_auth_val}" ]; then
      curl -sfL -o /tmp/data_backup.tar.gz "${_curl_auth}" "${_curl_auth_val}" "${_hf_url_tar}" 2>/dev/null || true
    else
      curl -sfL -o /tmp/data_backup.tar.gz "${_hf_url_tar}" 2>/dev/null || true
    fi
    if [ -s /tmp/data_backup.tar.gz ] && command -v tar >/dev/null 2>&1; then
      if tar -xzf /tmp/data_backup.tar.gz -C /data 2>/dev/null; then
        echo "[onebots] 已从仓库恢复整个 data 目录 (data_backup.tar.gz)"
      else
        echo "[onebots] 解压 data_backup.tar.gz 失败，将尝试仅恢复配置"
        rm -f /tmp/data_backup.tar.gz
      fi
    else
      rm -f /tmp/data_backup.tar.gz
      echo "[onebots] 未找到或下载 data_backup.tar.gz 失败（请先在 Web 端保存配置以生成备份；私有仓库需在 Secrets 中设置 HF_TOKEN）"
    fi
    # 若未有完整备份，再尝试仅恢复配置文件
    if [ ! -f /data/config.yaml ]; then
      if [ -n "${_curl_auth_val}" ]; then
        curl -sfL -o /data/config.yaml "${_curl_auth}" "${_curl_auth_val}" "${_hf_url_yaml}" 2>/dev/null || true
      else
        curl -sfL -o /data/config.yaml "${_hf_url_yaml}" 2>/dev/null || true
      fi
      if [ -s /data/config.yaml ]; then
        echo "[onebots] 已从仓库恢复 config_backup.yaml 到 /data/config.yaml"
      else
        rm -f /data/config.yaml
        echo "[onebots] 未找到或下载 config_backup.yaml 失败，将使用默认配置"
      fi
    fi
    # 新卷只恢复受信任扩展的轻量清单；已有持久化扩展目录保持本地依赖不变。
    if [ ! -f /data/extensions/package.json ]; then
      mkdir -p /data/extensions
      if [ -n "${_curl_auth_val}" ]; then
        curl -sfL -o /data/extensions/hf-restore.json "${_curl_auth}" "${_curl_auth_val}" "${_hf_url_extensions}" 2>/dev/null || true
      else
        curl -sfL -o /data/extensions/hf-restore.json "${_hf_url_extensions}" 2>/dev/null || true
      fi
      if [ -s /data/extensions/hf-restore.json ]; then
        echo "[onebots] 已恢复扩展依赖清单，启动前将按当前镜像目录校验并安装"
      else
        rm -f /data/extensions/hf-restore.json
      fi
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

if ! chmod 600 /data/config.yaml; then
  echo "[onebots] 错误: 无法将恢复配置权限收紧为 0600: /data/config.yaml"
  exit 1
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

ONEBOTS_EXTENSION_ROOT="${ONEBOTS_EXTENSION_ROOT:-/data/extensions}"
case "$ONEBOTS_EXTENSION_ROOT" in
  /*) ;;
  *)
    echo "[onebots] 错误: ONEBOTS_EXTENSION_ROOT 必须是绝对路径"
    exit 1
    ;;
esac
export ONEBOTS_EXTENSION_ROOT
NODE_PATH="${ONEBOTS_EXTENSION_ROOT}/node_modules:/app/development/node_modules${NODE_PATH:+:${NODE_PATH}}"
export NODE_PATH

if [ "$(id -u)" = "0" ]; then
  if ! chown -R node:node /data; then
    echo "[onebots] 错误: 无法将 /data 交给 node 用户，请检查持久化存储权限"
    exit 1
  fi
  su-exec node:node env HOME=/home/node USER=node LOGNAME=node \
    node /app/scripts/docker-extension-runtime.mjs --restore
  cd "$ONEBOTS_EXTENSION_ROOT"
  exec su-exec node:node env HOME=/home/node USER=node LOGNAME=node \
    node /app/packages/onebots/lib/bin.js "$@"
fi

if [ ! -r /data/config.yaml ] || [ ! -w /data ]; then
  echo "[onebots] 错误: 当前容器用户无法读取 /data/config.yaml 或写入 /data"
  exit 1
fi
node /app/scripts/docker-extension-runtime.mjs --restore
cd "$ONEBOTS_EXTENSION_ROOT"
exec node /app/packages/onebots/lib/bin.js "$@"
