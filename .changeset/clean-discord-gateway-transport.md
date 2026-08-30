---
"@onebots/adapter-discord": patch
---

让 Discord Gateway discovery 复用统一客户端已配置的 REST 实例，确保自定义 API 基址、注入传输与限流状态贯穿同一客户端；直接使用 Gateway 时也可显式注入 REST 实例。
