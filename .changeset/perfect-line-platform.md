---
"@onebots/adapter-line": patch
---

按 LINE 官方身份与会话生命周期重构事件投影：使用 destination / Bot Info user ID 作为 bot_id，补齐机器人加入和离开 canonical notice，将批量成员事件逐人投影，并在离开后清理持久化会话目录；按领域补齐 Audience、LIFF、Module / Chat Control、Mission Sticker 及群聊身份原生动作。
