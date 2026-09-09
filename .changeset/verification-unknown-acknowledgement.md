---
"@onebots/core": patch
"onebots": patch
"@onebots/web": patch
---

账号验证支持在网关完全停止后明确接受未知结果风险。CLI、TUI、Web 共用持久化回执和生命周期停止证明；保留原未知状态，不自动停止网关或重复提交，并支持响应丢失后的原编号查询。
