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

Connect the client to the complete account protocol root, for example `http://localhost:6727/teams/{account_id}/onebot/v12`. See the [Client SDK Guide](/en/guide/client-sdk) for Client creation, receive modes, existing-Host integration, and API calls.

## Related Links

- [Teams Adapter Configuration](/en/config/adapter/teams)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)
