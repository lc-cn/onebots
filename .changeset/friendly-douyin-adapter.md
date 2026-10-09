---
"@onebots/adapter-douyin": patch
"@onebots/web": patch
"onebots": patch
---

新增基于 `douyin-im` 的抖音适配器，接入扫码、短信、语音验证码与密码登录，Web 验证待办，私聊与群聊消息，联系人、群管理、入群审批、事件投影及能力目录。升级至 `douyin-im` 1.1，并把 SDK 的本机安全验证页通过一次性同源地址代理到 Web 管理端，支持远程完成登录与业务风控验证。
