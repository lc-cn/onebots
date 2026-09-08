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

# 配置只由用户确认保存；首次部署不会复制示例账号、协议或凭据。
HAS_CONFIG=0
CONFIG_PATH=/data/config.yaml
EXPECT_CONFIG=0
INTERACTIVE_SETUP=0
for arg in "$@"; do
  if [ "$EXPECT_CONFIG" = 1 ]; then CONFIG_PATH=$arg; EXPECT_CONFIG=0; continue; fi
  case "$arg" in
    -c|--config) HAS_CONFIG=1; EXPECT_CONFIG=1;;
    --config=*) HAS_CONFIG=1; CONFIG_PATH=${arg#--config=};;
    ui|tui|setup|--help|--version) INTERACTIVE_SETUP=1;;
  esac
done
if [ "$EXPECT_CONFIG" = 1 ]; then echo '[onebots] --config 需要文件路径'; exit 2; fi
if [ "$HAS_CONFIG" = 0 ]; then set -- -c /data/config.yaml "$@"; fi
if [ "$INTERACTIVE_SETUP" = 0 ] && [ ! -f "$CONFIG_PATH" ]; then
  echo '[onebots] 等待首次配置。请在宿主运行 sh scripts/docker-extensions.sh，安装依赖并在工作台填写、保存配置。'
  # 等待时不启动网关，也不宣告健康；收到停止信号立即退出，避免反复重启。
  trap 'exit 0' TERM INT
  while [ ! -f "$CONFIG_PATH" ]; do sleep 2 & wait "$!"; done
  trap - TERM INT
fi

# 扩展清单与后续安装依赖保存在数据卷；NODE_PATH 仅作为镜像内置依赖的兼容回退。
ONEBOTS_EXTENSION_ROOT="${ONEBOTS_EXTENSION_ROOT:-/data/extensions}"
case "$ONEBOTS_EXTENSION_ROOT" in
  /*) ;;
  *)
    echo "[onebots] 错误: ONEBOTS_EXTENSION_ROOT 必须是绝对路径"
    exit 1
    ;;
esac
export ONEBOTS_CONTAINER=1
export ONEBOTS_EXTENSION_MODE=isolated
export ONEBOTS_EXTENSION_ROOT
NODE_PATH="${ONEBOTS_EXTENSION_ROOT}/node_modules:/app/development/node_modules${NODE_PATH:+:${NODE_PATH}}"
export NODE_PATH

# root 只负责初始化挂载卷；长期运行的网关降权到镜像内置 node 用户（uid/gid 1000）。
# 递归迁移已有卷，确保旧版 root 容器创建的数据库、日志与配置仍可继续写入。
if [ "$(id -u)" = "0" ]; then
  if ! chown -R node:node /data; then
    echo "[onebots] 错误: 无法将 /data 交给 node 用户，请检查挂载卷权限"
    exit 1
  fi
  RESOLVED_ROOT=$(su-exec node:node node /app/scripts/docker-extension-release.mjs resolve "$ONEBOTS_EXTENSION_ROOT")
  if [ "$RESOLVED_ROOT" = "$ONEBOTS_EXTENSION_ROOT" ]; then
    su-exec node:node env HOME=/home/node USER=node LOGNAME=node node /app/scripts/docker-extension-runtime.mjs
  fi
  ONEBOTS_EXTENSION_ROOT=$(su-exec node:node node /app/scripts/docker-extension-release.mjs resolve "$ONEBOTS_EXTENSION_ROOT")
  export ONEBOTS_EXTENSION_ROOT
  NODE_PATH="$ONEBOTS_EXTENSION_ROOT/node_modules:/app/development/node_modules"
  export NODE_PATH
  cd "$ONEBOTS_EXTENSION_ROOT"
  exec su-exec node:node env HOME=/home/node USER=node LOGNAME=node \
    node /app/packages/onebots/lib/bin.js "$@"
fi

# 显式 --user 启动时尊重调用方身份，并在启动前给出清晰的卷权限错误。
if { [ -e "$CONFIG_PATH" ] && [ ! -r "$CONFIG_PATH" ]; } || [ ! -w /data ]; then
  echo "[onebots] 错误: 当前容器用户无法读取 /data/config.yaml 或写入 /data"
  exit 1
fi
RESOLVED_ROOT=$(node /app/scripts/docker-extension-release.mjs resolve "$ONEBOTS_EXTENSION_ROOT")
if [ "$RESOLVED_ROOT" = "$ONEBOTS_EXTENSION_ROOT" ]; then
  node /app/scripts/docker-extension-runtime.mjs
fi
ONEBOTS_EXTENSION_ROOT=$(node /app/scripts/docker-extension-release.mjs resolve "$ONEBOTS_EXTENSION_ROOT")
export ONEBOTS_EXTENSION_ROOT
NODE_PATH="$ONEBOTS_EXTENSION_ROOT/node_modules:/app/development/node_modules"
export NODE_PATH
cd "$ONEBOTS_EXTENSION_ROOT"
exec node /app/packages/onebots/lib/bin.js "$@"
