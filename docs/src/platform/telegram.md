# Telegram 适配器

`@onebots/adapter-telegram` 基于 grammY 1.46 与 Telegram Bot API 10.3，支持私聊、群组和频道，并保留原始 Update。grammY 已作为运行依赖随适配器安装，无需重复添加。

## 安装

```bash
pnpm add @onebots/adapter-telegram
```

## 接收配置

`receive_mode` 是接收方式的唯一来源；Web 管理端会按所选模式动态展示字段。

```yaml
telegram.your_bot_id:
  token: "YOUR_BOT_TOKEN"
  receive_mode: polling # polling、webhook 或 manual

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
  #   allowed_updates: ["message", "callback_query"]

  # 可选：HTTP(S)、SOCKS4 或 SOCKS5 代理
  proxy:
    url: "http://127.0.0.1:7890"
```

Webhook 必须使用 HTTPS URL，并建议配置随机 `secret_token`。切回 polling 时适配器会删除 Telegram 侧旧 Webhook，避免与 `getUpdates` 冲突。`manual` 不打开接收端口，可通过 `ingest(rawUpdate)` 接入队列、反向连接或已有服务，也可用 `acceptHttp(request)` 复用现有 Fetch/WinterCG Host 的校验和结构化响应。

## 平台能力

- 文本、@、图片、视频、音频、文件、贴纸、位置、联系人、回复与 Rich Message；媒体支持 `file_id`、远程 URL 和原生上传源。
- 消息编辑/删除、Reaction、置顶、转发/复制、投票、Forum Topic、邀请链接和群权限。
- Bot 命令与资料、Callback/Inline/支付查询、Guest Mode、Ephemeral Message 和 Join Request Query。
- Bot API 10.x 的 Rich Message、Live Photo、Managed Bot、个人频道消息、订阅和生成中止事件。
- 未标准化 Update 以 `notice.custom` 加 `raw_event` 无损交付；平台动作可由 `get_supported_actions` 动态发现。

Telegram Bot API 不提供完整群成员目录，因此适配器只声明真实可用的管理员列表、成员数量和单成员查询，不把管理员列表伪装成 `get_group_member_list`。

### Bot API 10.0 管理动作

`delete_message_reaction` 与 `delete_all_message_reactions` 必须且只能提供 `user_id` 或 `actor_chat_id`。`get_managed_bot_access_settings`、`set_managed_bot_access_settings` 和 `get_user_personal_chat_messages` 使用官方强类型入口。

`send_live_photo` 同时接收 `live_photo` 和 `photo`；两者可使用 Telegram `file_id`、本地路径、data URL 或 `base64://`。Telegram 官方接口不接受远程 URL，适配器会在调用前返回结构化校验错误。收到 Live Photo 时，完整结构保存在 `telegram_live_photo` 消息段中。

仍未封装为命名动作的新 Bot API 可通过 `call_telegram_api` 调用，并共享统一的 `TelegramError`、限流和日志链路。

## 获取 Token

在 Telegram 中联系 [@BotFather](https://t.me/BotFather)，发送 `/newbot` 并按提示创建机器人。

## 相关链接

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [grammY 文档](https://grammy.dev/)
- [客户端 SDK 使用指南](/guide/client-sdk)
