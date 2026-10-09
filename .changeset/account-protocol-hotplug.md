---
"@onebots/core": patch
"@onebots/adapter-twitch": patch
"@onebots/adapter-google-chat": patch
"@onebots/adapter-facebook-messenger": patch
"@onebots/adapter-instagram": patch
"@onebots/adapter-matrix": patch
"@onebots/adapter-icqq": patch
"@onebots/adapter-wechat-clawbot": patch
---

支持按账号与协议实例热应用配置、局部恢复失败配置，并明确共享平台 HTTP Host 与独立协议路由的资源归属。

协议变更排空在途操作与事件投递，停止超时保留恢复锁；共享平台路径可回收，旧账号迟到验证事件不污染新实例。
