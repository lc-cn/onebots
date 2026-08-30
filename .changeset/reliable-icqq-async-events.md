---
"@onebots/adapter-icqq": patch
---

闭合 ICQQ Gateway 异步事件出口：协议分发 rejection 现在会进入结构化 `client_error` 而不会形成未处理 Promise，单个出口失败不阻断其他监听器；账号启动失败也会返回生命周期调用方。
