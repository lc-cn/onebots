# Telegram Adapter

`@onebots/adapter-telegram` is built on grammY 1.46 and Telegram Bot API 10.3. It supports private chats, groups, channels, and lossless raw Update delivery. grammY is a runtime dependency of the adapter and does not need to be installed separately.

## Installation

```bash
pnpm add @onebots/adapter-telegram
```

## Receiving Updates

`receive_mode` is the single source of truth. The Web console shows only fields relevant to the selected mode.

```yaml
telegram.your_bot_id:
  token: "YOUR_BOT_TOKEN"
  receive_mode: polling # polling, webhook, or manual

  polling:
    timeout: 30
    limit: 100
    drop_pending_updates: false
    allowed_updates: ["message", "callback_query", "chat_member"]

  # receive_mode: webhook
  # webhook:
  #   url: "https://bot.example/telegram/your_bot_id/webhook"
  #   secret_token: "random-secret"
  #   max_connections: 40
  #   drop_pending_updates: false

  proxy:
    url: "http://127.0.0.1:7890" # HTTP(S), SOCKS4, or SOCKS5
```

Webhook mode requires an HTTPS URL and should use a random `secret_token`. Switching back to polling removes the remote webhook to avoid conflicts with `getUpdates`. Manual mode opens no receiving port: use `ingest(rawUpdate)` for queues or existing connections, or `acceptHttp(request)` to reuse validation and structured responses in an existing Fetch/WinterCG host.

## Native Capabilities

- Text, mentions, media, files, stickers, locations, contacts, replies, and Rich Messages.
- Message editing/deletion, reactions, pins, forwarding/copying, polls, forum topics, invite links, and chat permissions.
- Bot profile and command management, interaction/payment answers, Guest Mode, Ephemeral Messages, and Join Request Queries.
- Bot API 10.x Rich Messages, Live Photos, Managed Bots, personal-chat messages, subscriptions, and generation-stopped updates.
- Unmapped updates remain available as `notice.custom` with `raw_event`; `get_supported_actions` discovers named platform actions at runtime.

Telegram does not expose a complete group-member directory. The adapter therefore provides administrator listing, member count, and single-member lookup without misrepresenting administrators as `get_group_member_list`.

Bot API 10.0 management actions include `delete_message_reaction`, `delete_all_message_reactions`, `get_managed_bot_access_settings`, `set_managed_bot_access_settings`, and `get_user_personal_chat_messages`. Reaction deletion accepts exactly one of `user_id` and `actor_chat_id`.

`send_live_photo` accepts both `live_photo` and `photo` as Telegram file IDs, local paths, data URLs, or `base64://` sources. The official endpoint does not accept remote URLs, so the adapter rejects them before making the request. Received Live Photos retain their complete native structure in a `telegram_live_photo` segment.

Use `call_telegram_api` for future Bot API methods that do not yet have a named action; it shares the adapter's structured `TelegramError`, rate-limit, and logging path.

## Links

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [grammY documentation](https://grammy.dev/)
- [Client SDK Guide](/en/guide/client-sdk)
