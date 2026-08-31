# 企业微信自建应用

`@onebots/adapter-wecom` 对接企业微信自建应用官方 API。微信客服使用独立的 [`wecom-kf`](./wecom-kf.md)，两套 API 不混用。

```yaml
wecom.internal_app:
  corp_id: ww1234567890abcdef
  corp_secret: your_application_secret
  agent_id: '1000001'
  token: your_callback_token
  encoding_aes_key: your_43_character_key
  deduplicate_webhooks: true

  onebot.v11:
    use_http: true
    use_ws: true
```

接收消息 URL 默认为 `https://bot.example.com/wecom/internal_app/webhook`。适配器只接受验签并成功解密的企业微信回调，且会校验解密载荷中的 CorpID。

## 能力边界

- 私聊/直聊向企业成员发送应用消息；群聊指应用创建的 `appchat`。
- 部门和标签是组织管理对象，不映射为聊天群。
- 原生发送文本、媒体、文件、Markdown、卡片和图文；媒体先上传取得 `media_id`。
- 支持撤回具有服务端 `msgid` 的应用消息、获取应用群与成员、通讯录和标签管理；`appchat` 发送响应没有 `msgid`，不虚构可撤回能力。
- 通用 `at` 段会文本化为 `@userid`，不声明为可靠提醒能力。
- 所有事件保留解密 XML、密文 XML 和完整平台字段。
- `wecom_call` 为新接口提供受限路径、统一 token 和结构化错误。

完整动作与嵌入式 Webhook 契约见 [包 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wecom)。
