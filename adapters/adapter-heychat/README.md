# @onebots/adapter-heychat

OneBots 的黑盒语音官方机器人适配器。它使用官方 REST API 发送与管理资源，并通过官方正向 WebSocket 接收事件。

## 能力

- 发送私聊、频道 Markdown、图片、@、回复和卡片消息
- 更新、删除频道消息以及添加/取消消息回应
- 查询已加入房间、房间详情与成员，修改昵称、踢人和退出房间
- 管理角色、权限、房间表情、频道、邀请与语音成员
- 向语音频道输入在线媒体流并停止推流
- 投影斜杠命令、消息回应、成员加入/退出和卡片按钮事件；未知事件通过 `raw_event` 无损交付
- WebSocket 默认无限重连，支持可配置心跳、指数退避、代理和请求超时
- `call_heychat_api` 与 `upload_media` 为尚未封装或新增的官方接口保留受限底层入口

黑盒语音官方当前公布的机器人推送事件不包含普通频道消息。适配器不会把未经官方定义的 `type=5` 当作消息事件；`message` 事件对应 `type=50` 斜杠命令。

## 安装

```bash
pnpm add @onebots/adapter-heychat
```

## 配置

先在[黑盒语音机器人控制台](https://bot.xiaoheihe.cn)创建机器人、配置命令并邀请机器人进入房间：

```yaml
heychat.my_bot:
  token: your_bot_token
  onebot.v11:
    access_token: your_protocol_token
```

通常只需要 `token`。完整高级配置如下：

```yaml
heychat.my_bot:
  token: your_bot_token
  api_base_url: https://chat.xiaoheihe.cn
  upload_base_url: https://chat-upload.xiaoheihe.cn
  ws_url: wss://chat.xiaoheihe.cn/chatroom/ws/connect
  chat_version: 1.30.0
  voice_api_type: trtc
  heartbeat_interval_ms: 30000
  reconnect_initial_delay_ms: 1000
  reconnect_max_delay_ms: 30000
  request_timeout_ms: 30000
  proxy:
    url: socks5://127.0.0.1:1080
```

`api_base_url`、`upload_base_url` 和 `ws_url` 仅用于官方兼容代理、私有网关或测试环境，日常配置不应修改。

## 场景 ID

频道消息需要同时携带房间 ID 与频道 ID。适配器使用稳定的 `room_id:channel_id` 复合 `scene_id`：

```text
3884071942269132800:3884071973717917696
```

收到该频道的命令事件后，也可以使用单独的 `channel_id` 或 `room_id`，适配器会从有界上下文缓存解析目标。显式复合 ID 更适合无状态调用。

私聊直接把用户 ID 作为 `scene_id`，并使用 `scene_type: private`。

## 消息段

通用 `text`、`markdown`、`image`、`at`、`reply` 会编译成官方请求。图片必须是平台可访问的 URL；本地数据先通过 `upload_media` 上传。

平台原生段可表达完整卡片或新消息类型：

```json
{
  "type": "heychat_message",
  "data": {
    "body": {
      "msg_type": 20,
      "msg": "{\"data\":[{\"type\":\"card\",\"modules\":[]}]}",
      "addition": "{}"
    }
  }
}
```

`heychat_role` 与 `heychat_channel` 分别生成角色提及和频道提及。`heychat_message` 必须单独发送，避免原生请求与通用段的合并语义不明确。

## 平台扩展动作

除标准 OneBots 动作外，适配器显式开放官方能力：

- 消息：`send_channel_message`、`send_private_message`、`update_channel_message`、`delete_channel_message`、`set_message_reaction`
- 角色：`list_room_roles`、`create_room_role`、`update_room_role`、`delete_room_role`、`grant_room_role`、`revoke_room_role`
- 表情：`list_room_memes`、`delete_room_meme`、`update_room_meme`
- 房间与频道：`list_joined_rooms`、`get_room`、`leave_room`、`kick_room_member`、`create_channel`、`delete_channel`、`rename_channel`、`update_channel_settings`、`set_channel_password`、`create_channel_invite`
- 权限与语音：`set_room_ban`、`set_channel_permission`、`get_channel_permissions`、`move_voice_member`、`kick_voice_member`、`toggle_channel_microphone`、`toggle_room_microphone`、`toggle_room_speaker`、`get_user_voice_channel`、`list_voice_channel_members`
- 媒体流：`start_voice_stream`、`stop_voice_stream`
- 底层：`upload_media`、`call_heychat_api`

扩展动作参数直接沿用官方字段。底层调用只允许 `/chatroom/v2/`、`/chatroom/v3/` 和 `/chatroom/channel/` 下的 `GET`/`POST`，不会成为任意 URL 代理：

```json
{
  "action": "call_heychat_api",
  "params": {
    "path": "/chatroom/v2/room/view",
    "method": "GET",
    "query": { "room_id": "3884071942269132800" }
  }
}
```

`upload_media` 接收 `data`（Base64 或 Base64 data URL）、`filename` 和可选 `content_type`，最大 25 MiB。

## 文档

- [黑盒语音机器人帮助文档](https://s.apifox.cn/43256fe4-9a8c-4f22-949a-74a3f8b431f5)
- [官方机器人控制台](https://bot.xiaoheihe.cn)
- [官方示例](https://github.com/QingFengOpen/HeychatDemo)

## License

MIT
