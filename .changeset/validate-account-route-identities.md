---
"@onebots/core": patch
"@onebots/web": patch
onebots: patch
---

统一账号配置键与路由身份校验，在 Web、账号 API、启动、热重载、doctor 和服务预检进入扩展前拒绝空身份及会改变 URL 语义的字符。
