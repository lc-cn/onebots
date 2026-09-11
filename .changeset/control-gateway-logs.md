---
"@onebots/core": patch
"onebots": patch
"@onebots/web": patch
---

CLI、TUI 和 Web 共用管理服务的网关日志只读接口，网关停止后仍可读取最近日志。限制读取长度与固定路径，校验私有文件身份，过滤终端控制序列；不自动读取或提供命令执行。
