# Douyin

`@onebots/adapter-douyin` uses [`douyin-im`](https://github.com/zhinjs/douyin-im) to connect Douyin direct messages, stranger conversations, and group chats to OneBots.

Install the extension from the Web console, activate the candidate runtime, and add an account. QR login only needs a stable local alias:

```yaml
douyin.my-account:
  account_id: my-account
  login_method: qr
```

Set `login_method` to `sms` and provide `mobile` for SMS login. Password login also requires the sensitive `password` field. QR codes, verification-code inputs, and account selection are shown in the Web todo panel. Successful sessions are persisted under `data/douyin`.

The adapter supports text, mentions and image sending; direct and group message events; friend, group, and member queries; group membership operations and join-request review; and relationship, membership, message update/deletion, and reaction events.

Risk-control challenges use the official local verification component bundled by `douyin-im`. The SDK opens a one-time-token URL on the machine running OneBots but does not expose that complete URL to callers, so this page cannot currently be forwarded safely through a remote Web console.
