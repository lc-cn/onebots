# Microsoft Teams Adapter

Microsoft Teams is a team collaboration platform launched by Microsoft, supporting chat, video conferencing, file sharing, and more.

## Status

✅ **Implemented and Available**

## Features

- ✅ **Private Chat Messages** - Supports one-on-one chat with users
- ✅ **Group Chat Messages** - Supports channel and group messages
- ✅ **Message Editing** - Supports editing sent messages
- ✅ **Message Deletion** - Supports deleting messages
- ✅ **Adaptive Cards** - Supports sending rich adaptive cards
- ✅ **Event Subscription** - Supports member join/leave and other events
- ✅ **Webhook Mode** - Receives events via Webhook

## Installation

```bash
npm install @onebots/adapter-teams
# or
pnpm add @onebots/adapter-teams
```

## Configuration Example

### Basic Configuration

```yaml
teams.my_teams_bot:
  # Microsoft Teams configuration
  app_id: your_app_id
  app_password: your_app_password
  webhook:
    url: https://your-domain.com/teams/my_teams_bot/webhook
    port: 8080
  
  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
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
  platform: 'teams',
  account_id: 'my_teams_bot',
  protocol: 'onebot.v11',
  endpoint: 'ws://localhost:6727/teams/my_teams_bot/onebot/v11/ws',
  access_token: 'your_access_token',
});
```

## Related Links

- [Teams Adapter Configuration](/en/config/adapter/teams)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)

