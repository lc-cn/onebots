#!/bin/sh
set -eu

ONEBOTS_HOME=${ONEBOTS_HOME:-"$HOME/.onebots"}
RUNTIME_DIR="$ONEBOTS_HOME/runtime"
CONFIG_FILE="$ONEBOTS_HOME/config.yaml"
NODE_DIR="$ONEBOTS_HOME/node"

say() {
    printf '%s\n' "[OneBots] $*"
}

fail() {
    printf '%s\n' "[OneBots] 安装失败：$*" >&2
    exit 1
}

command -v curl >/dev/null 2>&1 || fail "需要 curl 下载运行环境"
command -v tar >/dev/null 2>&1 || fail "需要 tar 解压运行环境"

platform=$(uname -s)
case "$platform" in
    Linux) node_os=linux ;;
    Darwin) node_os=darwin ;;
    *) fail "暂不支持 $platform；Windows 请在 PowerShell 中使用 npm 安装" ;;
esac

machine=$(uname -m)
case "$machine" in
    x86_64|amd64) node_arch=x64 ;;
    arm64|aarch64) node_arch=arm64 ;;
    *) fail "暂不支持处理器架构 $machine" ;;
esac

node_usable=false
if command -v node >/dev/null 2>&1; then
    node_major=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')
    if [ "$node_major" -ge 24 ]; then
        node_usable=true
        NODE_BIN=$(command -v node)
    fi
fi

if [ "$node_usable" = false ]; then
    say "未找到 Node.js 24，正在安装独立运行环境…"
    work_dir=$(mktemp -d "${TMPDIR:-/tmp}/onebots-install.XXXXXX")
    trap 'rm -rf "$work_dir"' EXIT INT TERM
    checksums="$work_dir/SHASUMS256.txt"
    curl -fsSL "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt" -o "$checksums"
    archive=$(awk -v suffix="-$node_os-$node_arch.tar.gz" '$2 ~ suffix "$" { print $2; exit }' "$checksums")
    [ -n "$archive" ] || fail "Node.js 没有适用于 $node_os/$node_arch 的发行包"
    curl -fL "https://nodejs.org/dist/latest-v24.x/$archive" -o "$work_dir/$archive"
    expected=$(awk -v name="$archive" '$2 == name { print $1 }' "$checksums")
    if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "$work_dir/$archive" | awk '{ print $1 }')
    else
        actual=$(shasum -a 256 "$work_dir/$archive" | awk '{ print $1 }')
    fi
    [ "$actual" = "$expected" ] || fail "Node.js 安装包校验失败"
    rm -rf "$NODE_DIR"
    mkdir -p "$NODE_DIR"
    tar -xzf "$work_dir/$archive" -C "$NODE_DIR" --strip-components=1
    NODE_BIN="$NODE_DIR/bin/node"
fi

PATH="$(dirname "$NODE_BIN"):$PATH"
export PATH

NPM_BIN=$(dirname "$NODE_BIN")/npm
[ -x "$NPM_BIN" ] || NPM_BIN=$(command -v npm || true)
[ -n "$NPM_BIN" ] && [ -x "$NPM_BIN" ] || fail "Node.js 环境中未找到 npm"

mkdir -p "$RUNTIME_DIR"
if [ ! -f "$RUNTIME_DIR/package.json" ]; then
    cat >"$RUNTIME_DIR/package.json" <<'EOF'
{
  "name": "onebots-managed-runtime",
  "private": true,
  "version": "1.0.0"
}
EOF
fi

say "正在安装 OneBots、Web 管理端和默认 OneBot v11 协议…"
(
    cd "$RUNTIME_DIR"
    "$NPM_BIN" install --omit=dev onebots@latest @onebots/web@latest @onebots/protocol-onebot-v11@latest
)

ONEBOTS_BIN="$RUNTIME_DIR/node_modules/.bin/onebots"
[ -x "$ONEBOTS_BIN" ] || fail "OneBots 命令安装不完整"

say "正在创建安全配置并安装用户级常驻服务…"
(
    cd "$RUNTIME_DIR"
    ONEBOTS_EXTENSION_ROOT="$RUNTIME_DIR" "$ONEBOTS_BIN" setup --force -c "$CONFIG_FILE" -p onebot-v11
    ONEBOTS_EXTENSION_ROOT="$RUNTIME_DIR" "$ONEBOTS_BIN" install -c "$CONFIG_FILE"
    ONEBOTS_EXTENSION_ROOT="$RUNTIME_DIR" "$ONEBOTS_BIN" start
)

token=$(awk '$1 == "access_token:" { print $2; exit }' "$CONFIG_FILE" | tr -d "'\"")
port=$(awk '$1 == "port:" { print $2; exit }' "$CONFIG_FILE")
[ -n "$port" ] || port=6727

say "安装完成。"
say "管理地址：http://127.0.0.1:$port"
if [ -n "$token" ]; then
    say "首次登录鉴权码：$token"
    say "请登录后立即保存到密码管理器；该鉴权码不会再次显示。"
else
    say "请使用配置文件中的管理凭据登录：$CONFIG_FILE"
fi
say "以后可直接在 Web 的“功能扩展”页面安装 Slack、Telegram 等平台。"
