# Heychat Adapter Configuration

Configuration reference for the Heychat (黑盒语音) adapter.

## Format

```yaml
heychat.{account_id}:
  token: 'your_bot_token'
  api_base: 'https://chat.xiaoheihe.cn'
  ws_url: 'wss://chat.xiaoheihe.cn/chatroom/ws/connect'
  chat_version: '1.30.0'
  ping_interval: 30
  ignore_self_messages: true

  onebot.v11:
    access_token: 'your_v11_token'
```

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | yes | Bot token from [bot.xiaoheihe.cn](https://bot.xiaoheihe.cn) |
| `api_base` | string | no | REST API base URL |
| `ws_url` | string | no | WebSocket gateway URL |
| `chat_version` | string | no | Client version, default `1.30.0` |
| `ping_interval` | number | no | Heartbeat interval in seconds |
| `ignore_self_messages` | boolean | no | Ignore bot's own messages |

## Getting a Token

1. Certify at [open.xiaoheihe.cn](https://open.xiaoheihe.cn/zh_cn/chat_robot/home)
2. Create a bot at [bot.xiaoheihe.cn](https://bot.xiaoheihe.cn)
3. Copy the token from the bot detail page

## Notes

- Register slash commands in the bot console to receive type=50 events
- Use `room_id:channel_id` as scene_id when sending without prior context

## See also

- [Heychat platform guide](/en/platform/heychat)
