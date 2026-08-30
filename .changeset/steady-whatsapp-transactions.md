---
"@onebots/adapter-whatsapp": patch
---

将 WhatsApp Webhook、共享号码路由与手动入站统一为可等待的投递事务，异步监听器成功后才确认去重，并合并并发重投；抽离安全 Graph API 传输边界，新增 Commerce、消息二维码与 Flow 生命周期动作及稳定原生通知 ID。
