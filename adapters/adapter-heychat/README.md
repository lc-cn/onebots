# @onebots/adapter-heychat

OneBots 的黑盒语音官方机器人适配器。它使用官方 REST API 发送与管理资源，并通过官方正向 WebSocket 接收事件。

## 能力

- 发送私聊、频道 Markdown、图片、@、回复和卡片消息
- 更新、删除频道消息以及添加/取消消息回应
- 查询已加入房间、房间详情与成员，修改昵称、踢人和退出房间
- 管理角色、权限、房间表情、频道、邀请与语音成员
- 向语音频道输入在线媒体流并停止推流
- 完整接入用户 OAuth：生成授权地址、交换/刷新令牌、读取用户资料与房间语音/游戏时长
- 投影斜杠命令、消息回应、成员加入/退出和卡片按钮事件；未知事件通过 `raw_event` 无损交付
- WebSocket 默认无限重连，支持可配置心跳、指数退避、代理与握手超时
- `receive_mode: manual` 不创建正向连接；`await HeychatBot.ingest(rawEvent)` 与 `acceptWebSocket(socket)` 可让现有 Host、反向代理或已升级 socket 复用同一校验、去重和事件管线
- 事件按连接代次串行投递，仅在业务监听器与全部协议投影成功后确认精确 `sequence`；显式 `ingest()` 失败会拒绝 Promise 并允许宿主重投，socket 来源则在本地按配置退避重试，不会把业务错误伪装成无效协议帧
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
  receive_mode: websocket # 或 manual
  onebot.v11:
    access_token: your_protocol_token
```

通常只需要 `token`。完整高级配置如下：

```yaml
heychat.my_bot:
  token: your_bot_token
  receive_mode: websocket
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
  # 仅使用用户 OAuth 能力时配置
  oauth:
    enabled: true
    client_id: your_oauth_client_id
    client_secret: your_oauth_client_secret
    redirect_uri: https://example.com/oauth/callback
```

`api_base_url`、`upload_base_url` 和 `ws_url` 仅用于官方兼容代理、私有网关或测试环境，日常配置不应修改。

manual 模式仍保留 REST 出站能力，但不会建立 WebSocket、发送心跳或负责重连。宿主可逐条 `await bot.ingest(rawEvent)`，也可将 `ws` 已升级实例交给 `bot.acceptWebSocket(socket)`；后者返回解除监听函数，socket 的心跳、关闭与重连所有权仍属于宿主。显式接入方应在 Promise 拒绝时保留原事件并重投；只有监听器与协议分发全部成功后，同一连接代次内的精确 `sequence` 才会被确认为重复事件。

并发 `start()` 会共享同一次初始化并等待异步 `ready`；`stop()` 会先取消当前投递代次，再依次解除宿主 socket、关闭正向连接、等待本地事件队列和全部异步停止监听器，关闭失败不会留下仍可见的旧连接。

## 场景 ID

频道消息需要同时携带房间 ID 与频道 ID。适配器使用稳定的 `room_id:channel_id` 复合 `scene_id`：

```text
3884071942269132800:3884071973717917696
```

收到该频道的命令或卡片交互事件后，也可以使用单独的 `channel_id`，适配器会从有界上下文缓存解析目标。房间可能包含多个频道，因此单独的 `room_id` 不会被猜测成任意频道；无状态调用应始终使用显式复合 ID。

私聊直接把用户 ID 作为 `scene_id`，并使用 `scene_type: private`。

## 消息段

通用 `text`、`markdown`、`image`、`at`、`reply` 会编译成官方请求。图片可使用 HTTP(S) URL、本地路径、`data:` URL 或 Base64；适配器统一物化并上传到黑盒语音 CDN。`upload_file` 与 `upload_media` 使用同一条 25 MiB 上传管线。

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
- 房间与频道：`list_joined_rooms`、`get_room`、`leave_room`、`kick_room_member`、`rename_channel`、`update_channel_settings`、`set_channel_password`、`create_channel_invite`；创建和删除频道使用 canonical `create_channel` / `delete_channel`
- 权限与语音：`set_room_ban`、`set_channel_permission`、`get_channel_permissions`、`move_voice_member`、`kick_voice_member`、`toggle_channel_microphone`、`toggle_room_microphone`、`toggle_room_speaker`、`get_user_voice_channel`、`list_voice_channel_members`
- 媒体流：`start_voice_stream`、`stop_voice_stream`
- 用户 OAuth：`create_oauth_authorization_url`、`exchange_oauth_code`、`refresh_oauth_token`、`get_oauth_user_info`、`request_oauth_user_info`、`get_oauth_voice_duration`、`get_oauth_game_duration`
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

`upload_media` 接收 `data`（Base64、`base64://` 或 Base64 data URL）、`filename` 和可选 `content_type`，最大 25 MiB。文件名与 Content-Type 会在拼装 multipart 前校验，不能注入额外头部。

OAuth 动作使用独立的 `oauth.client_id` / `client_secret` / `redirect_uri`，不会把应用密钥放进普通机器人请求或动作参数。先调用 `create_oauth_authorization_url` 获取授权页，回调收到 `code` 后用 `exchange_oauth_code` 换取令牌；访问令牌由调用方保存并传给资料或时长动作。`scope` 可传空格分隔字符串或字符串数组；时长查询的秒级时间范围会在本地校验为正序且不超过官方规定的 30 天。`request_oauth_user_info` 用于用户在线时触发平台授权提示。

动作参数、账号与资源缺失、配置、平台响应和网络故障统一使用 `HeychatApiError`，并接入 OneBots 核心错误分类。调用方可以读取稳定的 `code`、HTTP `status`、API `path` 与 `details`，不需要解析错误文本。底层 `HeychatBot`、`HeychatWsClient` 及其完整事件映射类型均从包入口导出。

## 文档

- [黑盒语音机器人帮助文档](https://s.apifox.cn/43256fe4-9a8c-4f22-949a-74a3f8b431f5)
- [官方机器人控制台](https://bot.xiaoheihe.cn)
- [官方示例](https://github.com/QingFengOpen/HeychatDemo)

## License

MIT
