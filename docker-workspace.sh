#!/bin/sh
# 只将空挂载点交给最终运行身份；已有业务/认证目录绝不递归修正权限。
if [ -L /data ] || { [ -e /data ] && [ ! -d /data ]; }; then
  echo '[onebots] 错误: /data 必须是普通目录，不能是符号链接或文件'
  exit 1
fi
if [ ! -e /data ]; then mkdir -m 700 /data; fi
if ! DATA_CONTENT=$(find /data -mindepth 1 -maxdepth 1 -print -quit); then
  echo '[onebots] 错误: 无法检查 /data 的既有内容；未修改权限，请离线核对挂载卷'
  exit 1
fi
if [ "$(id -u)" = "0" ] && [ -z "$DATA_CONTENT" ]; then
  if [ "$(stat -c '%u:%g' /data)" != "$(id -u node):$(id -g node)" ]; then
    chown node:node /data
  fi
fi
run_workspace_user() {
  if [ "$(id -u)" = "0" ]; then
    su-exec node:node env HOME=/home/node USER=node LOGNAME=node "$@"
  else
    "$@"
  fi
}
if ! run_workspace_user sh -c '[ -r /data ] && [ -w /data ] && [ -x /data ]'; then
  echo '[onebots] 错误: 运行用户无法访问 /data；既有目录未自动修改，请停止服务后离线核对卷所有者和权限'
  exit 1
fi
