# @onebots/adapter-email

OneBots 邮件适配器。通过 SMTP 发送邮件，通过 IMAP IDLE 实时接收邮件，并提供线程、附件、搜索、标记和邮箱目录管理能力。

## 能力

- SMTP 密码或 OAuth2 认证，连接池与 HTTP/HTTPS/SOCKS 代理
- IMAP IDLE 实时接收、可选兜底轮询、无限指数退避重连
- 纯文本、HTML、内联图片、普通附件、CC/BCC、Reply-To 与 RFC Message-ID 线程
- 成功投影后再标记 `\\Seen`，避免处理失败时丢邮件
- `EmailClient.ingest()` 可把外部解析的邮件交给同一事件管线
- 结构化 `EmailError` 与白名单式 SMTP/IMAP 平台动作

## 安装

```bash
pnpm add @onebots/adapter-email
```

## 配置

字段只使用 snake_case；SMTP 与 IMAP 共用认证和代理，避免重复配置。

```yaml
email.my_bot:
  address: bot@example.com
  display_name: 我的机器人
  default_subject: 来自 OneBots 的消息
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

`auth.access_token` 可替代 `auth.password`。证书默认严格校验；只有接入受控的自签名服务时才应关闭对应的 `reject_unauthorized`。

## 原生邮件段

标准 `text`、`image`、`file` 和 `reply` 段均可发送。`email` 段用于设置邮件原生字段：

```ts
await adapter.sendMessage("my_bot", {
  scene_type: "direct",
  scene_id: adapter.createId("alice@example.com,bob@example.com"),
  message: [
    { type: "email", data: { subject: "发布通知", cc: ["owner@example.com"], priority: "high" } },
    { type: "text", data: { text: "版本已经发布。" } },
    { type: "file", data: { name: "report.pdf", path: "/srv/report.pdf" } },
  ],
});
```

接收事件在 `raw_event` 中保留完整 `EmailMessage`，在 `extensions.email` 中保留 UID、目录、主题、收件人和线程头。HTML 正文同时使用只读的 `email_html` 段保留，避免只留下有损生成的纯文本。

## 平台动作

通过 `callAction()` 可调用 `send_email`、`get_email`、`search_emails`、`list_mailboxes`、已读/星标、移动/删除邮件，以及创建、重命名、删除、订阅邮箱目录等动作。可用动作以 `get_supported_actions` 返回值为准。

`delete_message` 删除的是 IMAP 邮箱中的副本，不代表撤回已经投递给收件人的邮件。
