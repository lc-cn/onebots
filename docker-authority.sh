#!/bin/sh
# 此文件由入口脚本 source；只初始化独立持久卷内的全新私有子目录。
AUTHORITY_MOUNT=/var/lib/onebots-authority
AUTHORITY_DIRECTORY="$AUTHORITY_MOUNT/authority"
if [ -L "$AUTHORITY_MOUNT" ] || ! awk '$5=="/var/lib/onebots-authority" {found=1} END {exit !found}' /proc/self/mountinfo; then
  echo '[onebots] 错误: 必须独立持久挂载 /var/lib/onebots-authority；不能与 /data 一起复制'
  exit 1
fi
if [ ! -e "$AUTHORITY_DIRECTORY" ] && [ ! -L "$AUTHORITY_DIRECTORY" ]; then
  mkdir -m 700 "$AUTHORITY_DIRECTORY"
  if [ "$(id -u)" = "0" ]; then
    chown node:node "$AUTHORITY_DIRECTORY"
  fi
fi
if [ -L "$AUTHORITY_DIRECTORY" ] || [ ! -d "$AUTHORITY_DIRECTORY" ]; then
  echo '[onebots] 错误: 卷外身份目录不是普通目录'
  exit 1
fi
AUTHORITY_UID="$(id -u)"
if [ "$AUTHORITY_UID" = "0" ]; then AUTHORITY_UID="$(id -u node)"; fi
if [ "$(stat -c '%u:%a' "$AUTHORITY_DIRECTORY")" != "$AUTHORITY_UID:700" ]; then
  echo '[onebots] 错误: 既有卷外身份目录权限无效；未自动修复，请保留现场并诊断'
  exit 1
fi
