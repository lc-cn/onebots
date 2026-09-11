#!/bin/sh
set -eu
umask 077

ONEBOTS_HOME=${ONEBOTS_HOME:-"$HOME/.onebots"}
case "$ONEBOTS_HOME" in /*) ;; *) printf '%s\n' '[OneBots] ONEBOTS_HOME 必须是绝对路径' >&2; exit 1 ;; esac
RUNTIME_DIR="$ONEBOTS_HOME/runtime"
NODE_DIR="$ONEBOTS_HOME/node"
MARKER="$ONEBOTS_HOME/.manager-installed"
LOCK="$ONEBOTS_HOME/.install-lock"
work_dir=""
locked=false
say() { printf '%s\n' "[OneBots] $*"; }
fail() { say "安装未完成：$*；候选目录保留，请先核查，不会自动回滚或重新启动。" >&2; exit 1; }
cleanup() {
    status=$?
    trap - EXIT HUP INT TERM
    [ -z "$work_dir" ] || rm -rf "$work_dir"
    if [ "$locked" = true ]; then rmdir "$LOCK" || true; fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[ ! -L "$ONEBOTS_HOME" ] || fail "安装目录不能是符号链接"
if [ -f "$MARKER" ] && [ ! -L "$MARKER" ] && [ "$(cat "$MARKER")" = "onebots-manager-install-v1" ]; then
    say "此目录已有安装成功的管理程序。未修改依赖或重启服务，请使用现有 CLI 管理。"
    exit 0
fi
if [ -e "$ONEBOTS_HOME" ]; then
    [ -d "$ONEBOTS_HOME" ] || fail "安装路径不是目录"
    [ -z "$(ls -A "$ONEBOTS_HOME")" ] || fail "目录已有运行数据或未完成候选，原文件保持不变；旧服务请使用 onebots migrate"
else
    mkdir -p "$ONEBOTS_HOME"
fi
mkdir "$LOCK" 2>/dev/null || fail "另一安装进程已占用此目录"
locked=true

case "$(uname -s)" in
    Linux) node_os=linux ;;
    Darwin) node_os=darwin ;;
    *) fail "仅支持 Linux/macOS 原生服务" ;;
esac
case "$(uname -m)" in
    x86_64|amd64) node_arch=x64 ;;
    arm64|aarch64) node_arch=arm64 ;;
    *) fail "不支持此处理器架构" ;;
esac

NODE_BIN=$(command -v node || true)
node_major=0
if [ -n "$NODE_BIN" ]; then
    node_major=$(env -i PATH="$PATH" "$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')
fi
case "$node_major" in ''|*[!0-9]*) node_major=0 ;; esac
if [ "$node_major" -lt 24 ]; then
    command -v curl >/dev/null 2>&1 || fail "需要 curl 下载 Node.js"
    command -v tar >/dev/null 2>&1 || fail "需要 tar 解压 Node.js"
    [ ! -e "$NODE_DIR" ] && [ ! -L "$NODE_DIR" ] || fail "已有 Node.js 目录，拒绝覆盖"
    work_dir=$(mktemp -d "${TMPDIR:-/tmp}/onebots-install.XXXXXX")
    checksums="$work_dir/SHASUMS256.txt"
    say "正在下载并校验独立 Node.js 24 运行环境…"
    env -i PATH="$PATH" curl -q --proto '=https' --tlsv1.2 -fsSL --max-time 120 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$checksums"
    archive=$(awk -v suffix="-$node_os-$node_arch.tar.gz" '$2 ~ suffix "$" { print $2; exit }' "$checksums")
    case "$archive" in node-v24.*-"$node_os"-"$node_arch".tar.gz) ;; *) fail "没有匹配的 Node.js 24 发行包" ;; esac
    case "$archive" in *[!a-zA-Z0-9._-]*) fail "Node.js 发行包名称无效" ;; esac
    env -i PATH="$PATH" curl -q --proto '=https' --tlsv1.2 -fsSL --max-time 300 "https://nodejs.org/dist/latest-v24.x/$archive" -o "$work_dir/$archive"
    expected=$(awk -v name="$archive" '$2 == name { print $1; exit }' "$checksums")
    if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "$work_dir/$archive" | awk '{ print $1 }')
    else
        actual=$(shasum -a 256 "$work_dir/$archive" | awk '{ print $1 }')
    fi
    [ "$actual" = "$expected" ] || fail "Node.js 安装包校验失败"
    mkdir "$NODE_DIR"
    env -i PATH="$PATH" tar -xzf "$work_dir/$archive" -C "$NODE_DIR" --strip-components=1
    NODE_BIN="$NODE_DIR/bin/node"
fi
NPM_BIN="$(dirname "$NODE_BIN")/npm"
[ -x "$NPM_BIN" ] || fail "选定 Node.js 环境缺少 npm"
NODE_PATH_ENV="$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"

# 新目录独占；npm 不读取用户 HOME、全局 npmrc、环境授权或旧 runtime。
mkdir "$RUNTIME_DIR" "$ONEBOTS_HOME/.bootstrap" "$ONEBOTS_HOME/.bootstrap/home"
printf '%s\n' '{"name":"onebots-manager-runtime","private":true,"version":"1.0.0"}' > "$RUNTIME_DIR/package.json"
: > "$ONEBOTS_HOME/.bootstrap/user.npmrc"
: > "$ONEBOTS_HOME/.bootstrap/global.npmrc"
say "正在安装公开发布的 OneBots 管理程序…"
if ! (
    cd "$RUNTIME_DIR"
    env -i PATH="$NODE_PATH_ENV" HOME="$ONEBOTS_HOME/.bootstrap/home" LANG=C \
        NPM_CONFIG_USERCONFIG="$ONEBOTS_HOME/.bootstrap/user.npmrc" \
        NPM_CONFIG_GLOBALCONFIG="$ONEBOTS_HOME/.bootstrap/global.npmrc" \
        NPM_CONFIG_CACHE="$ONEBOTS_HOME/.bootstrap/cache" \
        "$NPM_BIN" install --omit=dev --ignore-scripts --no-audit --no-fund --save-exact \
        --registry=https://registry.npmjs.org onebots@latest
); then fail "公开依赖安装失败"; fi

PACKAGE_DIR="$RUNTIME_DIR/node_modules/onebots"
ONEBOTS_BIN="$PACKAGE_DIR/lib/bin.js"
for entry in "$ONEBOTS_BIN" "$PACKAGE_DIR/lib/control/host.js" "$PACKAGE_DIR/lib/gateway/entry.js"; do
    [ -f "$entry" ] && [ -s "$entry" ] && [ ! -L "$entry" ] || fail "发布包缺少新管理架构工件，未执行旧 CLI"
done
WEB_ENTRY="$RUNTIME_DIR/node_modules/@onebots/web/dist/index.html"
NESTED_WEB_ENTRY="$PACKAGE_DIR/node_modules/@onebots/web/dist/index.html"
if [ ! -s "$WEB_ENTRY" ] && [ ! -s "$NESTED_WEB_ENTRY" ]; then fail "发布包缺少 Web 管理端工件"; fi

# install 只登记用户级管理服务；空白工作区由管理服务初始化，不预填业务配置。
run_cli() (
    cd "$RUNTIME_DIR"
    env -u NODE_OPTIONS "$NODE_BIN" "$ONEBOTS_BIN" "$@"
)
say "正在登记并启动用户级管理服务…"
run_cli install --data-dir "$ONEBOTS_HOME" || fail "系统服务安装失败"
run_cli start || fail "系统服务启动结果未确认"
STATUS_FILE="$ONEBOTS_HOME/.bootstrap/status.json"
run_cli status --json > "$STATUS_FILE" || fail "系统服务状态检查失败"
env -i PATH="$NODE_PATH_ENV" "$NODE_BIN" --input-type=module -e '
import fs from "node:fs";
try {
    const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (state.schemaVersion !== 1 || state.installation !== "control" || state.manager?.state !== "running" || state.manager?.ipc !== "available" || state.serviceRecoveryRequired !== false || state.diagnostic !== null || state.gateway?.recoveryRequired !== false) process.exit(1);
} catch { process.exit(1); }
' "$STATUS_FILE" || fail "管理服务尚未确认运行，不能报告成功"
printf '%s\n' 'onebots-manager-install-v1' > "$MARKER.tmp"
mv "$MARKER.tmp" "$MARKER"
say "管理服务已安装并确认运行。未安装平台或输出协议，未自动启动业务账号。"
say "使用设备码配对：\"$NODE_BIN\" \"$ONEBOTS_BIN\" auth bootstrap --data-dir \"$ONEBOTS_HOME\""
say "配置和管理：\"$NODE_BIN\" \"$ONEBOTS_BIN\" ui --data-dir \"$ONEBOTS_HOME\""
