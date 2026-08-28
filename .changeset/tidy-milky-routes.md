---
"@imhelper/milky-v1": patch
"@onebots/protocol-milky-v1": patch
---

修复 Milky SDK 在 OneBots 兼容模式下遗漏 `/api/` 路径段而导致所有协议 API 返回 404 的问题，并更正服务端路由日志。
