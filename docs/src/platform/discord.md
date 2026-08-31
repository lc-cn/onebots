# Discord 适配器

`@onebots/adapter-discord` 直接实现 Discord API v10，不依赖 `discord.js`。适配器支持 Gateway、Interactions Webhook、Webhook Events 与手动接入，并提供可独立使用的强类型 Lite 客户端。

## 安装

```bash
pnpm add @onebots/adapter-discord
```

## Gateway 配置

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
    - GuildMessagePolls
    - DirectMessagePolls
  presence:
    status: online
    activities:
      - name: "正在运行 OneBots"
        type: 0
```

Web 表单会把 Intents 渲染为选择列表，把 Presence activities 渲染为可动态增减的结构化表单。`GuildMembers` 与 `MessageContent` 等特权 Intent 还需在 Discord Developer Portal 开启。

管理端会按账号实际 Gateway intents 展示消息、成员、Reaction 与 Poll Vote 的可达场景。缺少 `MessageContent` 不会被误报为收不到消息；管理端会单独提示 Guild 消息的正文、附件与 Embed 可能为空。Interactions、Webhook Events 与手动接入模式则按各自真实事件入口展示，不套用 Gateway intents。

Gateway 默认无限重连，支持 Resume、心跳 ACK、Identify 限速、分片、Presence 与 `AbortSignal`。每个 Dispatch 在所有事件出口处理成功后才提交 sequence，失败时从最后成功位置恢复。

## Interactions 与 Webhook Events

```yaml
discord.my_bot:
  account_id: my_bot
  token: "your_discord_bot_token"
  receive_mode: interactions # 或 webhook_events
  application_id: "123456789012345678"
  public_key: "64位十六进制Application Public Key"
```

- Interactions Endpoint：`POST /discord/{account_id}/interactions`
- Webhook Events Endpoint：`POST /discord/{account_id}/events`

两种模式复用 OneBots HTTP Host，完成 Ed25519 验签、重放时间窗校验、并发合并与成功后去重，不会新开端口。

已有 Host 可配置 `receive_mode: manual`，把已验签事件交给 `account.client.ingest(rawEvent)`；标准 Request 可交给 `acceptHttp(request)`，非 Fetch Host 可调用 `ingestHttp(...)` 获取结构化响应。

## 原生资源模型

Discord Guild 与 Channel 分别映射统一 `get_guild_*` 和 `get_channel_*`，不会伪装成 Group。消息支持文本、提及、回复、Embed、Sticker、多媒体附件和原生 `discord_message` 段。

常用扩展动作覆盖：

- Guild 成员、角色、线程、邀请、Reaction 与消息置顶；
- Auto Moderation、Scheduled Event 与 Guild Emoji；
- `search_guild_messages`：支持 Discord 的重复数组 query，需要 `READ_MESSAGE_HISTORY` 与 `MESSAGE_CONTENT` Intent；
- `set_voice_channel_status`：设置或清除语音频道状态；
- Soundboard 默认音效、Guild 音效增删改查与频道播放；
- Interaction 原始回复与 Followup 生命周期；
- `send_gateway_command` 与受固定 API 根约束的 `call_discord_api`。

完整动作和 Lite SDK 示例见[包 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-discord)。

## 相关链接

- [客户端 SDK 使用指南](/guide/client-sdk)
- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord Developer Documentation](https://docs.discord.com/developers/intro)
