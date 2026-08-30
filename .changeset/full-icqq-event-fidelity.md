---
"@onebots/adapter-icqq": patch
---

移除 ICQQ 接收消息的有损中间模型，直接公开完整 SDK `MessageElem` 与发送者/请求语义，补齐 QQNT 媒体、按钮、论坛、引用和转发节点投影，并从包入口导出完整事件类型与运行时平台枚举。
