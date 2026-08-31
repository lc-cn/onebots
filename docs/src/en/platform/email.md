# Email Platform

The email adapter sends through SMTP and receives through IMAP IDLE. It preserves threads, addresses, attachments, and raw headers, and reconnects indefinitely after a disconnect.

## Installation

```bash
pnpm add @onebots/adapter-email
```

## Configuration

```yaml
email.my_bot:
  address: bot@example.com
  display_name: My Bot
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

SMTP and IMAP share authentication and proxy settings. `auth.access_token` can replace the password. `security` accepts `tls`, `starttls`, or `plain`.

## Message model

- One recipient is a `private` scene; reply-all conversations use `direct`.
- The scene ID is a comma-separated list of email addresses.
- RFC Message-ID becomes the common `message_id`; IMAP UID and mailbox remain in `extensions.email`.
- Common text, image, file, and reply segments are supported. The `email` segment controls subject, HTML, CC, BCC, Reply-To, references, priority, and headers.
- Inbound HTML is also preserved losslessly in the receive-only `email_html` segment.

`callAction()` exposes native send, search, mailbox listing, read/flag operations, moving/deleting messages, and mailbox management. Query the exact action list with `get_supported_actions`.

::: warning Deletion semantics
`delete_message` deletes the IMAP mailbox copy. SMTP cannot recall mail that has already been delivered.
:::

See [Email adapter configuration](/en/config/adapter/email) for every field.
