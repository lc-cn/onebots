# @onebots/adapter-wecom

OneBots 的企业微信自建应用官方 API 适配器。它复用 OneBots HTTP Host 接收加密回调，支持应用消息、应用创建的群聊、通讯录与企业管理 API。

> 微信客服的 `kf/sync_msg` / `kf/send_msg` 属于不同产品模型，请使用 `@onebots/adapter-wecom-kf`。

## 配置

```yaml
wecom.internal_app:
  corp_id: ww1234567890abcdef
  corp_secret: your_application_secret
  agent_id: "1000001"
  token: your_callback_token
  encoding_aes_key: your_43_character_key
  deduplicate_webhooks: true

  onebot.v11:
    use_http: true
    use_ws: true
```

在自建应用“接收消息”中填写 `https://bot.example.com/wecom/internal_app/webhook`。默认路径为 `/wecom/{account_id}/webhook`，可用 `webhook_path` 覆盖。回调必须使用企业微信的加密模式，解密后会校验 `corp_id`。

## 消息与会话

- `private` / `direct` 使用 `/cgi-bin/message/send` 向成员发送应用消息。
- `group` 指真实的应用群聊 `appchat`，使用 `/cgi-bin/appchat/send`；部门和标签不会伪装成群聊。
- 支持文本、图片、语音、视频、文件、Markdown 和任意 `wecom_message` 原生消息。通用 `at` 段会保留为 `@userid` 可读文本，但企业微信自建应用 API 不保证产生提醒。
- 媒体必须先上传并使用 `media_id` 或 `wecom://media/{media_id}`，不会降级成 URL 占位文本。
- `delete_message` 调用 `/cgi-bin/message/recall` 撤回返回服务端 `msgid` 且符合时限的应用消息；`appchat/send` 不返回 `msgid`，因此群消息不可通过该接口撤回。

## 原生 API

平台动作覆盖应用详情、临时素材、模板卡片更新、应用群聊、部门、成员、标签、邀请、加入企业二维码与回调 IP。`wecom_call` 可调用新增或低频接口：

```ts
await adapter.callAction("internal_app", "wecom_call", {
  method: "POST",
  path: "/cgi-bin/appchat/create",
  body: { name: "项目群", owner: "zhangsan", userlist: ["zhangsan", "lisi"] },
});
```

access token 自动缓存，并在企业微信报告失效时刷新且只重试一次。所有非零 `errcode` 都会抛出保留 `details`、`path` 与错误码的 `WeComApiError`。

## 底层接入

`WeComWebhookHost.ingest()` 返回结构化 HTTP 响应，`acceptHttp()` 可挂载到已有 Koa 风格 Host；`WeComClient.ingest()` 可接收已经解密/解析的事件。适配器不会自行监听端口。

事件统一保留 `raw_event`，其中 `RawXml` 是解密后的完整 XML，`EncryptedXml` 是收到的密文外层 XML。

[企业微信开发者中心](https://developer.work.weixin.qq.com/)
