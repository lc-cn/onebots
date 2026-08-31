# QQ 适配器

QQ 适配器基于腾讯官方 `@tencent-connect/qqbot-nodejs`，覆盖 C2C、群聊、频道和频道私信，并开放完整原生 Client 与认证后的 OpenAPI 入口。

## 功能支持

- ✅ WebSocket / 共享 HTTP Webhook
- ✅ 文本、图片、语音、视频、文件和富消息
- ✅ 频道、成员、角色、权限、公告、表态、日程、帖子与音频控制
- ✅ C2C 主动唤醒、输入状态和流式消息
- ✅ 未知 Gateway 事件无损透传
- ✅ 无限连接代次恢复

## 配置

```yaml
qq.my_bot:
  appid: 'your_app_id'
  secret: 'your_app_secret'
  receive_mode: websocket
  intents:
    - GROUP_AND_C2C_EVENT
    - INTERACTION
    - PUBLIC_GUILD_MESSAGES
```

Webhook 直接使用 OneBots 主端口：

```yaml
qq.my_bot:
  appid: 'your_app_id'
  secret: 'your_app_secret'
  receive_mode: webhook
  webhook_path: '/qq/my_bot/webhook'
```

回调地址示例：`https://bot.example.com/qq/my_bot/webhook`。请求链必须保留原始请求体以完成 QQ Ed25519 验签。

旧接收字段和 intent 别名不会自动转换，配置错误会在启动时直接暴露。

## 相关文档

- [QQ 适配器配置](/config/adapter/qq)
- [腾讯官方 SDK](https://github.com/tencent-connect/qqbot-nodejs)
- [QQ 开放平台](https://q.qq.com/)
