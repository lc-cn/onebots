# Douyin

`@onebots/adapter-douyin` uses [`douyin-im`](https://github.com/zhinjs/douyin-im) to connect Douyin direct messages, stranger conversations, and group chats to OneBots.

Install the extension from the Web console, activate the candidate runtime, and add an account. QR login only needs a stable local alias:

```yaml
douyin.my-account:
  account_id: my-account
  login_method: qr
```

Both SMS and password login require `mobile`. Set `login_method` to `sms` for SMS login; password login additionally requires the sensitive `password` field. QR codes, verification-code inputs, and account selection are shown in the Web todo panel, where an SMS challenge can be switched to a voice code. Successful sessions are persisted under `data/douyin`.

The adapter supports text, mentions and image sending; direct and group message events; friend, group, and member queries; group membership operations and join-request review; and relationship, membership, message update/deletion, and reaction events.

Risk-control challenges use the official verification component bundled by `douyin-im` 1.1. OneBots converts the loopback URL returned by the SDK into a one-time, same-origin link in the Web todo panel, so remote and headless deployments can complete the challenge without a desktop session on the server.

The proxy uses a high-entropy capability path kept only in memory, accepts only the SDK service on `127.0.0.1`, expires after five minutes, and is revoked when the challenge completes, fails, is replaced, or the account stops. Treat this short-lived link as a credential and do not share it with untrusted parties.
