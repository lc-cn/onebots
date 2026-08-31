---
"@onebots/core": patch
"onebots": patch
---

为协议实例增加由账号编排维护的生命周期状态，并让 `/ready`、Prometheus 指标与 `onebots doctor` 同时验证协议出口是否真正启动；空配置保持管理面可访问，但显式报告 `configured: false`。
