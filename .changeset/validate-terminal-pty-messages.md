---
"onebots": patch
"@onebots/web": patch
---

在调用原生 PTY 前校验终端输入与尺寸，并在 PTY 退出后关闭客户端连接以触发可靠重连。
