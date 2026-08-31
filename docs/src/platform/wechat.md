# 微信公众号适配器

`@onebots/adapter-wechat` 使用微信公众平台官方 API，接收安全 Webhook，并通过 OneBots 协议层向下游提供事件与 API。

## 安装与配置

```bash
pnpm add @onebots/adapter-wechat
```

```yaml
wechat.my_mp:
  app_id: wx1234567890abcdef
  app_secret: your_app_secret
  token: your_webhook_token
  encoding_aes_key: your_43_character_key
  passive_reply_timeout_ms: 4500
  deduplicate_webhooks: true

  onebot.v11:
    use_http: true
    use_ws: true
```

在公众平台将服务器 URL 配置为 `https://bot.example.com/wechat/my_mp/webhook`。默认路径为 `/wechat/{account_id}/webhook`，可用 `webhook_path` 覆盖。生产环境建议启用安全模式并配置 `encoding_aes_key`。

## 能力边界

- 公众号会话只有用户私聊，不存在群聊；用户标签不会被映射为群组。
- 接收文本、图片、语音、视频、短视频、位置、链接以及所有事件通知。
- 发送文本、媒体、图文和原生 `wechat_message`；媒体须先取得 `media_id`。
- `reply` 段可在 Webhook 窗口内提交被动回复，超时后发送客服消息。
- 用户、标签、黑名单、素材、草稿、发布、菜单、二维码、模板和群发均有原生动作。
- 未命名的新接口可通过 `wechat_call` 调用，且仍使用统一 token 缓存与结构化错误。

所有事件均保留 `raw_event`；嵌套 XML 的完整原文位于 `raw_event.RawXml`。

完整动作和底层接入示例见 [包 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wechat)。
