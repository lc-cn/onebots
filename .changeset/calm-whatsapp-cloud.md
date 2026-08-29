---
"@onebots/adapter-whatsapp": patch
"@onebots/core": patch
---

重构 WhatsApp Cloud API 适配器：统一 snake_case 配置与共享 HTTP Webhook，增加原始请求验签、重复投递过滤、完整事件投影、多段消息、媒体与管理动作、通用 Graph API 客户端，并移除 axios 和私有监听配置。

同时将 Adapter 工厂类型收敛到注册表真实使用的 BaseApp 构造约定，避免严格模式下合法适配器需要类型断言。
