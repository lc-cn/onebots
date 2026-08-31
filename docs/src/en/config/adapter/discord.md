# Discord Adapter Configuration

Discord adapter configuration guide.

## Configuration Format

```yaml
discord.{account_id}:
  # Discord platform configuration
  token: 'your_discord_bot_token'  # Required: Discord Bot Token
  intents:  # Optional: Gateway Intents
    - Guilds
    - GuildMessages
    - GuildMembers
    - GuildMessageReactions
    - DirectMessages
    - DirectMessageReactions
    - MessageContent
  partials:  # Optional: Partials
    - Message
    - Channel
    - Reaction
  presence:  # Optional: Bot status
    status: online  # online, idle, dnd, invisible
    activities:
      - name: 'Running onebots'
        type: 0  # 0: Playing, 1: Streaming, 2: Listening, 3: Watching, 5: Competing
  
  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
  onebot.v12:
    access_token: 'your_v12_token'
```

## Configuration Fields

| Field | Type | Required | Description | Default |
|-------|------|----------|-------------|---------|
| `token` | string | Yes | Discord Bot Token | - |
| `intents` | string[] | No | Gateway Intents, event types to receive | `[]` |
| `partials` | string[] | No | Partials, partial data support | `[]` |
| `presence` | object | No | Bot status and activities | - |

## Required Intents

Depending on your bot's functionality, you may need to enable the following Privileged Intents:

- **PRESENCE INTENT** - If you need to display member information in status
- **SERVER MEMBERS INTENT** - If you need to get server member list
- **MESSAGE CONTENT INTENT** - If you need to read message content (required for most bots)

Enable these in [Discord Developer Portal](https://discord.com/developers/applications).

## Related Links

- [Discord Platform](/en/platform/discord)
- [Quick Start](/en/guide/start)

