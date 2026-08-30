---
"@onebots/adapter-email": patch
---

修正邮件业务投递失败仍被标记已读并去重的问题，统一 IMAP 与 manual 的成功提交语义，使用邮箱地址投影机器人身份，新增邮件复制和任意 flags 动作，并收紧附件与 Header 参数校验。
