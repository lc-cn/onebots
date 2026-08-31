---
"@onebots/core": patch
"onebots": patch
---

就绪检查现在要求每个已配置账号至少拥有一个协议出口；`/ready`、Prometheus 指标与 doctor 会直接报告缺少协议出口的账号数量，避免平台连接在线但无法向下游交付事件时被误判为可服务。
