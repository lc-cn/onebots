---
"@onebots/adapter-dingtalk": patch
"@onebots/adapter-icqq": patch
---

补齐钉钉机器人入站媒体资源闭环：统一 `get_resource_temp_url` 与命名平台动作可将事件携带的 `downloadCode` 兑换为临时 HTTPS 地址，媒体段同步提供标准资源标识，并更新中英文文档。

同步公开 ICQQ 已实现的临时资源 URL 能力，确保运行时入口与 capability manifest 一致。
