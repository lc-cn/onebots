# Notifications and alerts

Notification settings are stored by the long-lived manager, independently of the gateway's `config.yaml`. The manager can display delivery history while the gateway is stopped. Use an external uptime monitor for failures of the manager itself.

In **Notifications and alerts**, create generic JSON Webhook, SMTP email, or Bark channels. SMTP profiles and recipient groups are reusable. A Bark channel accepts multiple device keys and either the official `https://api.day.app` endpoint or a self-hosted server. Save and test channels, then create rules selecting events, all or specific accounts, and destination channels. Paused channels and rules do not send notifications.

Public HTTPS is required by default for Webhook and Bark. Private/local HTTP targets require an explicit per-channel opt-in. The read API masks SMTP passwords, Webhook secrets, and Bark device keys.

Structured failures include gateway startup/exit, generation activation, and configuration application failures; ordinary error logs do not alert. Account first-online, recovered, offline, explicit transport disconnect, and login-interaction events can be selected independently. Explicit transport disconnects are reported by ICQQ, IRCv3, Slack Socket Mode, Discord Gateway, KOOK Gateway, Heychat, IMAP email, Zulip Event Queue, Telegram polling, Mattermost WebSocket, and Twitch EventSub WebSocket; generic pending states are not interpreted as network failures.

Account changes are recorded immediately and sent within 30 seconds so same-kind changes can be batched. An outage that recovers within that period becomes one brief-outage notice with its duration. Login challenges send separately. Challenge secrets and QR images are not stored in the queue. A channel may opt in to current QR images or platform links: Webhooks include display blocks, email attaches the QR image or includes links, while Bark opens only the protected management challenge page. Bark login alerts require a configured HTTPS external management URL.

Generic Webhooks receive a `POST` JSON object with `version: 1`, a summary `event`, and an `events` array. Authentication may be none, Bearer, or HMAC-SHA256. For HMAC, `X-OneBots-Signature: sha256=<hex>` signs the UTF-8 string `<X-OneBots-Timestamp>.<raw JSON body>`. Redirects are not followed. Failed deliveries persist and retry with exponential backoff; expired login challenges are not replayed. Delivery history supports manual retry.

If Bark accepts only some devices in a batch, the delivery is marked failed and automatic retries stop to avoid notifying successful devices twice. Check the delivery record before retrying the whole group manually.
