# Discord Adapter

The Discord adapter is fully implemented and supports connecting to onebots service through Discord Bot API.

## Status

✅ **Implemented and Available**

## Features

- ✅ **Message Sending/Receiving**
  - Channel message sending/receiving
  - Private chat message sending/receiving
  - Supports text, images, audio, video, files, and other message formats
- ✅ **Server (Guild) Management**
  - Get server list and information
  - Leave server
- ✅ **Channel Management**
  - Get channel list and information
  - Create, update, delete channels
- ✅ **Member Management**
  - Get member information
  - Kick members
  - Mute members
  - Set member nickname
- ✅ **Message Reactions**
  - Add/remove message reactions
- ✅ **Embed Messages**
  - Supports rich text Embed messages

## Installation

```bash
npm install @onebots/adapter-discord discord.js
# or
pnpm add @onebots/adapter-discord discord.js
```

## Configuration

Configure Discord account in `config.yaml`:

```yaml
# Discord bot account configuration
discord.your_bot_id:
  # Discord platform configuration
  token: 'your_discord_bot_token'  # Discord Bot Token, required
  intents:  # Optional, Gateway Intents
    - Guilds
    - GuildMessages
    - GuildMembers
    - GuildMessageReactions
    - DirectMessages
    - DirectMessageReactions
    - MessageContent
  partials:  # Optional, Partials
    - Message
    - Channel
    - Reaction
  presence:  # Optional, bot status
    status: online  # online, idle, dnd, invisible
    activities:
      - name: 'Running onebots'
        type: 0  # 0: Playing, 1: Streaming, 2: Listening, 3: Watching, 5: Competing
  
  # OneBot V11 protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
  
  # OneBot V12 protocol configuration
  onebot.v12:
    access_token: 'your_v12_token'
```

## Client SDK Usage

```typescript
import { ImHelper } from 'imhelper';
import { OneBotV11Adapter } from '@imhelper/onebot-v11';

const client = new ImHelper();

// Register OneBot V11 protocol adapter
client.registerAdapter('onebot.v11', OneBotV11Adapter);

// Connect to onebots server
await client.connect({
  platform: 'discord',
  account_id: 'your_bot_id',
  protocol: 'onebot.v11',
  endpoint: 'ws://localhost:6727/discord/your_bot_id/onebot/v11/ws',
  access_token: 'your_access_token',
});
```

## Related Links

- [Discord Adapter Configuration](/en/config/adapter/discord)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)

