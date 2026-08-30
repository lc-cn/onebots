---
"@onebots/adapter-discord": patch
---

闭合 Discord Gateway 启动生命周期：并发连接共享同一启动过程，停止时解绑 AbortSignal，并允许 fatal close 后在同一实例上重新连接。
