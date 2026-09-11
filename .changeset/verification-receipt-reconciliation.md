---
"@onebots/core": patch
"onebots": patch
"@onebots/web": patch
---

账号验证结果未知时，可显式核对原网关保留的回执。确定结果追加到原记录，保留未知历史且不重新调用平台 SDK；原实例已退出或证据不足时继续保留保护。CLI、TUI 和 Web 共用对账接口。
