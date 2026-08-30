# @onebots/adapter-email

OneBots 邮件适配器。通过 SMTP 发送邮件，通过 IMAP IDLE 实时接收邮件，并提供线程、附件、搜索、标记和邮箱目录管理能力。

## 能力

- SMTP 密码或 OAuth2 认证，连接池与 HTTP/HTTPS/SOCKS 代理
- IMAP IDLE 实时接收、可选兜底轮询、无限指数退避重连
- 纯文本、HTML、内联图片、普通附件、CC/BCC、Reply-To 与 RFC Message-ID 线程
- 逐封隔离无法解析的邮件，正常邮件不会被同批毒邮件阻塞
- 投影去重与 `\\Seen` 确认分离：业务投递失败保留未读并重投，标记失败只重试确认
- 停止会完整尝试 IMAP、SMTP、启动与重连任务清理；非预期失败在本地清理完成后结构化传播
- 可等待的 `EmailClient.ingest()` 把外部邮件交给同一可靠事件管线
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
  receive_mode: imap
  auth:
    method: password
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

`auth.method` 可选 `password` 或 `oauth2`，Web 表单只展示对应凭据；OAuth2 模式填写 `auth.access_token`。未显式设置方式的现有配置会根据 access token 是否存在确定认证方式。SMTP 与 IMAP 始终共用同一选择，不会把未选中的凭据发送给服务端。证书默认严格校验；只有接入受控的自签名服务时才应关闭对应的 `reject_unauthorized`。

已有邮件接收器可配置 `receive_mode: manual` 并省略整个 `imap` 配置。客户端仍会验证和保留 SMTP 发送能力，但不会创建 IMAP 连接；外部系统通过 `await account.client.ingest(email)` 将已解析的 `EmailMessage` 交给与 IMAP 相同的可靠管线。全部 raw 与 canonical 监听器成功后才提交去重状态，失败会向调用方传播并允许重投。邮箱搜索、标记、复制、移动、删除及目录管理等 IMAP 动作会明确返回 `EMAIL_IMAP_DISABLED`。

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

接收事件在 `raw_event` 中保留完整 `EmailMessage`，在 `extensions.email` 中保留 UID、目录、主题、收件人和线程头。HTML 正文同时使用只读的 `email_html` 段保留，避免只留下有损生成的纯文本。发送 `reply` 时会同时生成 `In-Reply-To` 与去重后的 `References`；显式 `email.html` 优先于纯文本自动生成的 HTML alternative，自定义 Header 会拒绝非法字段名和换行注入。

缺少 RFC Message-ID 的邮件会获得包含目录、UIDVALIDITY 与 UID 的可逆 `onebots-imap:v1:` 原生标识，标准 `get_message` 与 `delete_message` 因此仍能精确回到来源；邮箱代次变化时会返回 `EMAIL_UIDVALIDITY_CHANGED`，绝不把旧 ID 误指向新邮件。由于原邮件没有可引用的 RFC 线程头，对这类标识发送 `reply` 会明确返回 `EMAIL_THREAD_ID_UNAVAILABLE`。无法解析的邮件会报告 `EMAIL_MESSAGE_REJECTED` 并在启用 `mark_seen` 时隔离为已读，原始邮件不会被删除。

## 平台动作

通过 `callAction()` 可调用 `send_email`、`get_email`、`search_emails`、`list_mailboxes`、已读/星标、任意 IMAP flags、复制/移动/删除邮件，以及创建、重命名、删除、订阅邮箱目录等动作。另提供 `get_mailbox_status`、`get_mailbox_quota`、`noop_imap` 与 `append_raw_email`，用于读取目录计数/配额、探活和把规范 Base64 的 RFC822 原文追加到 Sent/Drafts 等目录；UIDVALIDITY 与 MODSEQ 会作为字符串返回，保证远程 JSON 可序列化。

所有平台动作拒绝未知外层字段；IMAP 搜索条件、附件、STATUS query 与 flags 也使用闭合参数契约。`get_email` 必须且只能提供 `uid` 或 `message_id` 之一，原始邮件追加最大 50 MiB。可用动作以 `get_supported_actions` 返回值为准。附件必须且只能提供 `content`、`path`、`href` 中的一种来源；自定义 Header 与标准消息入口共用名称和换行注入校验。

`delete_message` 删除的是 IMAP 邮箱中的副本，不代表撤回已经投递给收件人的邮件。
