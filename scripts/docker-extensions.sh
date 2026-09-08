#!/bin/sh
# 在 Docker 宿主机运行；Docker socket 不传入任何安装或网关容器。
set +x
set -eu
set -f
umask 077
WIZARD=0
ACTION=${1:-}
if [ -z "$ACTION" ]; then
  if [ ! -t 0 ]; then echo '请在终端运行此向导，或使用 install <扩展名> / rollback'; exit 2; fi
  WIZARD=1
  printf 'OneBots 扩展管理\n  1. 安装扩展\n  2. 恢复上一版本\n请选择 [1]: '
  IFS= read -r CHOICE
  case "${CHOICE:-1}" in
    1) set -- install;;
    2) set -- rollback;;
    *) echo '已取消'; exit 0;;
  esac
  ACTION=$1
fi
if [ "$ACTION" != install ] && [ "$ACTION" != rollback ]; then
  echo '用法: sh scripts/docker-extensions.sh（交互向导）'
  echo '      sh scripts/docker-extensions.sh install icqq [--apply]'
  echo '      sh scripts/docker-extensions.sh rollback [--apply]'
  exit 2
fi
shift
APPLY=0
PACKAGES=
EXPECTED=
for item in "$@"; do
  if [ "$item" = --apply ]; then APPLY=1; continue; fi
  case "$item" in ''|*[!a-zA-Z0-9@/._-]*) echo '扩展参数无效'; exit 2;; esac
  if [ "$ACTION" = rollback ]; then EXPECTED=$item; else PACKAGES="$PACKAGES $item"; fi
done
if [ "$ACTION" = install ] && [ "$WIZARD" = 0 ] && [ -z "$PACKAGES" ]; then echo '请明确选择至少一个扩展'; exit 2; fi
CONTAINER=${ONEBOTS_CONTAINER_NAME:-}
if [ -z "$CONTAINER" ]; then
  # 只识别当前 Compose 项目中的 onebots 服务，不扫描或猜测其他部署。
  CONTAINER=$(docker compose ps -aq onebots 2>/dev/null || true)
  case "$CONTAINER" in *'
'*) echo '检测到多个 OneBots 容器，请用 ONEBOTS_CONTAINER_NAME 指定一个'; exit 1;; esac
  CONTAINER=${CONTAINER:-onebots}
fi
RUNNING_IMAGE=$(docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || true)
DATA=${ONEBOTS_DATA_DIR:-}
if [ -n "$RUNNING_IMAGE" ] && [ -z "$DATA" ]; then
  DATA=$(docker inspect --format '{{range .Mounts}}{{if and (eq .Destination "/data") (eq .Type "bind")}}{{.Source}}{{end}}{{end}}' "$CONTAINER")
  if [ -z "$DATA" ]; then echo '此部署未使用本地 /data 绑定目录，当前安装器不支持；不会改动容器'; exit 1; fi
fi
DATA=${DATA:-"$(pwd)/data"}
mkdir -p "$DATA/extensions"
STORE=$(cd "$DATA/extensions" && pwd -P)
DATA=$(dirname "$STORE")
IMAGE=${ONEBOTS_IMAGE:-${RUNNING_IMAGE:-ghcr.io/lc-cn/onebots:master}}
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then docker pull "$IMAGE"; fi
IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$IMAGE")
if [ "$WIZARD" = 1 ]; then
  printf '数据目录：%s\n' "$DATA"
  if [ -n "$RUNNING_IMAGE" ]; then
    APPLY=1
    printf '目标容器：%s；完成后会短暂重启并检查运行状态。\n' "$CONTAINER"
  else
    echo '尚未创建容器；安装完成后运行 docker compose up -d。'
  fi
  if [ "$ACTION" = rollback ]; then
    printf '确认恢复上一版本？[y/N]: '
    IFS= read -r ANSWER
    case "$ANSWER" in y|Y|yes|YES) ;; *) echo '已取消'; exit 0;; esac
  fi
fi
if [ "$APPLY" = 1 ]; then
  if [ "$RUNNING_IMAGE" != "$IMAGE_ID" ]; then echo '目标容器与安装镜像不一致；请先使用相同镜像创建容器'; exit 1; fi
  MOUNT_SOURCE=$(docker inspect --format '{{range .Mounts}}{{if and (eq .Destination "/data") (eq .Type "bind")}}{{.Source}}{{end}}{{end}}' "$CONTAINER")
  if [ -z "$MOUNT_SOURCE" ]; then echo '目标容器未使用 /data 绑定目录，拒绝重启'; exit 1; fi
  MOUNT_SOURCE=$(cd "$MOUNT_SOURCE" && pwd -P)
  if [ "$MOUNT_SOURCE/extensions" != "$STORE" ]; then echo '目标容器未使用此 data 绑定目录，拒绝重启其他部署'; exit 1; fi
fi
ID="$(date -u +%Y%m%d%H%M%S)-$$"
TEMP=$(mktemp -d)
LOCKED=0
cleanup() {
  outcome=$?
  trap - EXIT
  set +e
  docker rm -f "onebots-download-$ID" "onebots-verify-$ID" "onebots-plan-$ID" "onebots-configure-$ID" >/dev/null 2>&1
  if [ "$LOCKED" = 1 ]; then manager unlock "$ID" >/dev/null 2>&1; fi
  # 临时 UI 文件由容器 UID 1000 创建；由同一 UID 清理，避免宿主权限差异。
  docker run --rm --network none --read-only --user 1000:1000 --entrypoint node \
    --mount "type=bind,src=$TEMP,dst=/request" "$IMAGE_ID" -e 'const fs=require("fs"); for(const name of fs.readdirSync("/request"))fs.rmSync("/request/"+name,{recursive:true,force:true});' >/dev/null 2>&1
  rm -rf "$TEMP"
  exit "$outcome"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
manager() {
  docker run --rm --network none --read-only --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
    --security-opt no-new-privileges --user 0:0 --entrypoint node \
    --mount "type=bind,src=$STORE,dst=/data/extensions" \
    "$IMAGE_ID" /app/scripts/docker-extension-release.mjs "$1" /data/extensions "$ID" "${2:-$ID}"
}
manager init
LOCKED=1
ready() {
  EXPECTED_RUNTIME=$(manager current)
  count=0
  while [ "$count" -lt 30 ]; do
    if docker exec --user 1000:1000 "$CONTAINER" node /app/scripts/docker-extension-release.mjs assert-running /data/extensions "$EXPECTED_RUNTIME" >/dev/null 2>&1 &&
       docker exec --user 1000:1000 "$CONTAINER" node /app/scripts/docker-healthcheck.mjs >/dev/null 2>&1; then return 0; fi
    count=$((count + 1)); sleep 2
  done
  return 1
}
if [ "$ACTION" = rollback ]; then
  # 在安装锁内读取当前版本，用户不用复制内部版本 ID。
  if [ -z "$EXPECTED" ]; then EXPECTED=$(manager current); fi
  if [ "$EXPECTED" = legacy ]; then echo '还没有可恢复的扩展版本'; exit 1; fi
  manager rollback "$EXPECTED"
  if [ "$APPLY" = 1 ]; then docker restart "$CONTAINER" >/dev/null; ready || { echo '回滚后在线验证失败，请检查容器日志'; exit 1; }; fi
  echo '[onebots] 已切回上一版本'; exit 0
fi
manager plan > "$TEMP/previous-plan.json"
chmod 644 "$TEMP/previous-plan.json"
NPMRC=${ONEBOTS_NPMRC_FILE:-}
if [ "$WIZARD" = 1 ]; then
  set --
  if [ -f "$DATA/config.yaml" ]; then set -- --mount "type=bind,src=$DATA/config.yaml,dst=/run/onebots/config.yaml,readonly"; fi
  # 复用 TUI 表单，只交接选择和临时凭据；不挂载数据卷、旧依赖或 Docker socket。
  docker run --rm -it --name "onebots-plan-$ID" --network none --read-only --cap-drop ALL \
    --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETUID --cap-add SETGID \
    --tmpfs /tmp:rw,nosuid,nodev --security-opt no-new-privileges --user 0:0 --entrypoint sh \
    --mount "type=bind,src=$TEMP,dst=/request" -e ONEBOTS_INSTALL_AUTH_AVAILABLE="${NPMRC:+1}" "$@" "$IMAGE_ID" \
    -c 'chown -R node:node /request; chmod 755 /request; exec su-exec node:node node /app/packages/onebots/lib/tui/installation-app.js /request'
  PACKAGES=$(docker run --rm --network none --read-only --user 1000:1000 --entrypoint node \
    --mount "type=bind,src=$TEMP/request.json,dst=/request.json,readonly" "$IMAGE_ID" --input-type=module \
    -e 'await import("/app/packages/onebots/lib/index.js"); const {readInstallationRequest}=await import("/app/packages/onebots/lib/installation-request.js"); console.log(readInstallationRequest("/request.json").packages.map(spec=>spec.slice(0,spec.lastIndexOf("@"))).join(" "));')
  if [ -z "$NPMRC" ]; then NPMRC="$TEMP/npmrc"; fi
fi
if [ -n "$NPMRC" ] && [ ! -f "$NPMRC" ]; then echo 'ONEBOTS_NPMRC_FILE 不是可读文件'; exit 1; fi
PRIVATE_ICQQ=0
case " $PACKAGES " in *' icqq '*|*' @onebots/adapter-icqq '*) PRIVATE_ICQQ=1;; esac
if grep -q '"@onebots/adapter-icqq"' "$TEMP/previous-plan.json"; then PRIVATE_ICQQ=1; fi
if [ "$PRIVATE_ICQQ" = 1 ]; then
    if [ -z "$NPMRC" ] && [ -t 0 ]; then
      printf 'ICQQ GitHub Packages Token（read:packages，隐藏输入）: '
      OLD_STTY=$(stty -g); stty -echo
      trap 'stty "$OLD_STTY"; exit 130' INT TERM
      IFS= read -r TOKEN || { stty "$OLD_STTY"; exit 1; }
      stty "$OLD_STTY"; printf '\n'
      trap 'exit 130' INT; trap 'exit 143' TERM
      case "$TOKEN" in ''|*[!a-zA-Z0-9_]*) echo 'Token 格式无效'; exit 1;; esac
      NPMRC="$TEMP/npmrc"
      printf '@icqqjs:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=%s\n' "$TOKEN" > "$NPMRC"
      unset TOKEN
    fi
    if [ -z "$NPMRC" ]; then echo '私有安装需要 ONEBOTS_NPMRC_FILE，Token 不接受命令行参数'; exit 1; fi
fi
if [ -z "$NPMRC" ]; then NPMRC="$TEMP/npmrc"; : > "$NPMRC"; fi
NPMRC=$(cd "$(dirname "$NPMRC")" && pwd -P)/$(basename "$NPMRC")
CANDIDATE="/data/extensions/releases/$ID"
echo "[onebots] 候选版本 ${ID}；先下载，后无凭据离线验证。现有版本不改动。"
# root 仅复制私有 npmrc 到临时内存目录并降权；pnpm 以 node 用户运行且禁用所有安装脚本。
docker run --rm --name "onebots-download-$ID" --read-only --cap-drop ALL \
  --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETUID --cap-add SETGID \
  --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=1g --user 0:0 --entrypoint node \
  --mount "type=bind,src=$STORE/releases/$ID,dst=$CANDIDATE" \
  --mount "type=bind,src=$TEMP/previous-plan.json,dst=/run/onebots/previous-plan.json,readonly" \
  --mount "type=bind,src=$NPMRC,dst=/run/secrets/npmrc,readonly" \
  "$IMAGE_ID" /app/scripts/docker-extension-installer.mjs download "$CANDIDATE" "$ID" $PACKAGES
# 第二个容器只挂载候选目录，既无 secret，也无网络和旧版本目录。
docker run --rm --name "onebots-verify-$ID" --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=1g --user 1000:1000 --entrypoint node \
  --mount "type=bind,src=$STORE/releases/$ID,dst=$CANDIDATE" \
  "$IMAGE_ID" /app/scripts/docker-extension-installer.mjs verify "$CANDIDATE" "$ID" ${ONEBOTS_ALLOW_BUILD:-}
manager activate
if [ "$WIZARD" = 1 ]; then
  echo '[onebots] 依赖验证通过，进入账号配置工作台。保存配置并退出后，由宿主应用。'
  docker run --rm -it --name "onebots-configure-$ID" --mount "type=bind,src=$(dirname "$STORE"),dst=/data" \
    --mount "type=bind,src=$TEMP/request.json,dst=/run/onebots/installation-request.json,readonly" \
    -e ONEBOTS_INSTALLATION_REQUEST=/run/onebots/installation-request.json \
    "$IMAGE_ID" ui --configure
  if [ ! -f "$DATA/config.yaml" ]; then
    echo '[onebots] 依赖已就绪，但配置尚未保存。网关保持等待配置，不会启动示例账号；可再次运行向导继续。'
    exit 0
  fi
fi
if [ "$APPLY" = 1 ]; then
  if ! docker restart "$CONTAINER" >/dev/null || ! ready; then
    echo '[onebots] 新版本上线验证失败，正在恢复上一版本'
    manager rollback
    docker restart "$CONTAINER" >/dev/null
    ready || { echo '[onebots] 旧版本在线验证也失败，请检查配置与容器日志'; exit 1; }
    echo '[onebots] 已恢复旧版本，新安装未上线'; exit 1
  fi
  echo "[onebots] $ID 已应用并通过在线验证"
else
  echo "[onebots] 安装完成。已有容器执行 docker compose restart onebots；首次部署执行 docker compose up -d。"
fi
