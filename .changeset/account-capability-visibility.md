---
"onebots": patch
"@onebots/web": patch
---

管理 API 现在保留 `describeCapabilities(accountId)` 返回的账号级能力覆写，Web 能力面板可按账号查看并区分专属清单与适配器默认清单，同时以稀疏映射避免重复传输未变化的能力数据。
