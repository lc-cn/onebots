---
"onebots": patch
---

Windows 原生服务宿主以受保护 named pipe 发布带 revision 和 freshness 的管理程序及网关状态；网关写入前先使旧快照失效，避免本地 status 把中断前状态误报为当前状态。
