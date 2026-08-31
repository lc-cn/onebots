---
"@onebots/core": patch
"onebots": patch
---

根管理与终端 WebSocket 现在会在协议升级前执行与 HTTP 管理 API 一致的动态 token 鉴权，未授权请求返回 HTTP 401。热重载管理凭据后会撤销全部会话与刷新令牌并关闭既有管理连接，避免旧凭据继续读取配置或执行控制动作。
