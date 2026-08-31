---
"@onebots/adapter-wecom-kf": patch
---

修正微信客服同步与回调在业务投递失败后仍确认事件的问题，并串行化多客服账号的原子游标提交。
