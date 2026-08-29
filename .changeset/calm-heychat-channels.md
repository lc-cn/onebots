---
"@onebots/adapter-heychat": patch
---

收紧黑盒语音频道寻址与 API 路径边界，不再把房间 ID 猜测为任意频道；为回应和卡片交互补齐 guild/channel 身份与上下文缓存，统一机器人状态身份，并为 WebSocket 握手增加超时保护。
