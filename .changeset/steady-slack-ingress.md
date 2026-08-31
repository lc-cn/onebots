---
"@onebots/adapter-slack": patch
---

统一 Slack HTTP Events、Slash Command 与交互表单的验签入站边界，新增 ingestHttp 与标准 Request acceptHttp；去重改为业务投影成功后提交，首次连接使用无限退避恢复，并修正真实 bot_id、Socket envelope、消息编辑上下文、状态身份、成员目录并发和分页游标停滞问题。
