# Discord Adapter

`@onebots/adapter-discord` implements Discord API v10 directly and does not depend on `discord.js`. It supports Gateway, Interactions Webhooks, Webhook Events, and manual ingress, and includes a standalone strongly typed Lite client.

## Installation

```bash
pnpm add @onebots/adapter-discord
```

## Gateway mode

```yaml
discord.my_bot:
  account_id: my_bot
  token: "your_discord_bot_token"
  receive_mode: gateway
  intents:
    - Guilds
    - GuildMembers
    - GuildMessages
    - GuildMessageReactions
    - DirectMessages
    - DirectMessageReactions
    - MessageContent
  presence:
    status: online
    activities:
      - name: "Running OneBots"
        type: 0
```

The Web form renders Intents as constrained choices and Presence activities as a dynamic structured list. Privileged intents such as `GuildMembers` and `MessageContent` must also be enabled in the Discord Developer Portal.

Gateway reconnects indefinitely by default and supports Resume, heartbeat ACK checks, Identify rate limits, sharding, Presence, and `AbortSignal`. A dispatch sequence is committed only after all event destinations succeed; failures resume from the last committed position.

## Interactions and Webhook Events

```yaml
discord.my_bot:
  account_id: my_bot
  token: "your_discord_bot_token"
  receive_mode: interactions # or webhook_events
  application_id: "123456789012345678"
  public_key: "64-character hexadecimal Application Public Key"
```

- Interactions endpoint: `POST /discord/{account_id}/interactions`
- Webhook Events endpoint: `POST /discord/{account_id}/events`

Both modes reuse the OneBots HTTP host for Ed25519 verification, replay-window validation, concurrent redelivery coalescing, and commit-after-success deduplication. They do not open another port.

With `receive_mode: manual`, an existing host can pass verified events to `account.client.ingest(rawEvent)`. Standard Requests can use `acceptHttp(request)`, while non-Fetch hosts can call `ingestHttp(...)` for a structured response.

## Native resource model

Discord Guild and Channel resources map to canonical `get_guild_*` and `get_channel_*` actions; Guilds are not presented as Groups. Messages support text, mentions, replies, embeds, stickers, media attachments, and the native `discord_message` segment.

Named platform actions cover:

- Guild members, roles, threads, invites, reactions, and message pins;
- Auto Moderation, Scheduled Events, and Guild Emoji;
- `search_guild_messages`, including repeated array query parameters, with `READ_MESSAGE_HISTORY` and the `MESSAGE_CONTENT` intent;
- `set_voice_channel_status` for setting or clearing ephemeral voice-channel status;
- default and Guild Soundboard sounds, complete Guild sound lifecycle, and playback in a voice channel;
- original Interaction responses and Followup lifecycle;
- `send_gateway_command` and the fixed-origin `call_discord_api` escape hatch.

See the [package README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-discord) for the complete action list and Lite SDK examples.

## Related links

- [Client SDK Guide](/en/guide/client-sdk)
- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord Developer Documentation](https://docs.discord.com/developers/intro)
