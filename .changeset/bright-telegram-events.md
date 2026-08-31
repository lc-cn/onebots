---
"@onebots/adapter-telegram": patch
---

统一 Telegram Webhook、manual 与标准 Request 入站链路，首次身份连接使用无限退避恢复；修正真实 bot_id、状态身份和成功后去重提交，并完善机器人与成员生命周期、服务消息和原生 Update 投影。
