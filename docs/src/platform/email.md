# 邮件平台

邮件适配器通过 SMTP 发送、IMAP IDLE 接收邮件。它保留邮件线程、地址、附件与原始头信息，并在连接关闭后持续重连。

## 安装

```bash
pnpm add @onebots/adapter-email
```

## 配置示例

```yaml
email.my_bot:
  address: bot@example.com
  display_name: 我的机器人
  auth:
    user: bot@example.com
    password: your-app-password
  smtp:
    host: smtp.example.com
    port: 587
    security: starttls
    pool: true
  imap:
    host: imap.example.com
    port: 993
    security: tls
    mailbox: INBOX
    mark_seen: true
    poll_interval_ms: 60000
  onebot.v11:
    access_token: your-token
```

认证与代理由 SMTP、IMAP 共用。可用 `auth.access_token` 替代密码；`security` 可选 `tls`、`starttls` 或 `plain`。

已有邮件系统可使用 `receive_mode: manual` 并省略 IMAP，通过 `await account.client.ingest(email)` 可靠投递已解析邮件；SMTP 发送能力不受影响。

## 消息模型

- 单个收件人投影为 `private`，多个回复收件人投影为 `direct`。
- 会话 ID 是逗号分隔的邮箱地址，可直接 reply-all。
- RFC Message-ID 是通用 `message_id`；IMAP UID 和邮箱目录保留在 `extensions.email`。
- 文本、图片和附件使用通用段；HTML 原文还会使用接收方向的 `email_html` 段无损保留。
- 发送方向可用 `email` 段设置主题、HTML、CC、BCC、Reply-To、References、优先级与自定义头。

## 原生动作

`callAction()` 提供完整邮件发送、搜索、目录列表、已读/未读、星标、移动、删除，以及邮箱目录创建、重命名、删除和订阅管理。动作由能力清单统一声明，可通过 `get_supported_actions` 查询。

::: warning 删除语义
`delete_message` 删除 IMAP 邮箱中的邮件副本，不是 SMTP 撤回。已经投递到收件方的邮件无法由标准邮件协议撤回。
:::

完整字段见[邮件适配器配置](/config/adapter/email)。
