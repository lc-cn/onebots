---
"@onebots/adapter-qq": patch
---

QQ Gateway 事件改为有序等待完整协议投影，失败时持续退避重试，并在账号停止时取消旧投递代次。
