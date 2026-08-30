# 邮件适配器配置

Web 管理端会按凭据、传输、投递、过滤与高级设置分区生成表单。配置只接受 snake_case 字段，不保留旧的重复 SMTP/IMAP 认证字段。

## 基础与认证

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `receive_mode` | 否 | 默认 `imap`；`manual` 复用已有邮件接收器 |
| `address` | 是 | 对外发件邮箱地址 |
| `display_name` | 否 | 发件人显示名称 |
| `default_subject` | 否 | 消息未携带主题时使用 |
| `auth.user` | 是 | SMTP 与 IMAP 共用用户名 |
| `auth.password` | 二选一 | 密码、授权码或应用专用密码 |
| `auth.access_token` | 二选一 | OAuth2 Access Token，配置后优先使用 |

## SMTP

`smtp.host` 必填。`smtp.security` 可选 `tls`、`starttls`、`plain`，默认 `starttls`；未指定端口时分别使用 465 或 587。可配置连接池、最大连接数、单连接邮件数和三类超时。

## IMAP

`receive_mode: imap` 时 `imap.host` 必填。`imap.security` 默认 `tls`，未指定端口时 TLS 使用 993，其余使用 143。`mailbox` 默认 `INBOX`，`mark_seen` 默认开启。

客户端以 IMAP IDLE 接收新邮件。`poll_interval_ms` 是 IDLE 的兜底检查，默认 60000；设为 0 仅关闭兜底轮询。断线重连默认从 1 秒指数退避至 30 秒且不会停止，可通过 `retry_initial_delay_ms` 和 `retry_max_delay_ms` 调整。

`receive_mode: manual` 时可省略整个 `imap`，SMTP 发送仍可用。已有接收器应调用 `await client.ingest(email)`；raw、canonical 监听器和协议投影全部成功后才提交去重状态。

## TLS 与代理

SMTP 和 IMAP 默认校验证书。只有接入受控的自签名服务器时才应关闭各自的 `reject_unauthorized`。

顶层 `proxy` 同时作用于 SMTP 与 IMAP，支持 HTTP、HTTPS、SOCKS4 和 SOCKS5：

```yaml
proxy:
  url: socks5://127.0.0.1:1080
  username: optional-user
  password: optional-password
```

## 完整示例

```yaml
email.gmail_bot:
  address: your-email@gmail.com
  display_name: Gmail 机器人
  default_subject: 来自 OneBots 的消息
  receive_mode: imap
  auth:
    method: password
    user: your-email@gmail.com
    password: your-app-password
  smtp:
    host: smtp.gmail.com
    port: 587
    security: starttls
    pool: true
    max_connections: 5
  imap:
    host: imap.gmail.com
    port: 993
    security: tls
    mailbox: INBOX
    mark_seen: true
    poll_interval_ms: 60000
    retry_initial_delay_ms: 1000
    retry_max_delay_ms: 30000
```

Gmail 通常需要应用专用密码或 OAuth2；QQ 邮箱通常使用 IMAP/SMTP 授权码。
