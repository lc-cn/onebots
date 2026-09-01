---
"@onebots/core": patch
"onebots": patch
---

在账号停止、删除、热重载或候选回滚时撤销其 HTTP 与 WebSocket 路由，避免旧处理器继续占用新账号的同名路径。
