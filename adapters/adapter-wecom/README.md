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
  receive_mode: webhook
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
- 图片、语音、视频和文件可直接使用 HTTPS URL、本地路径、`data:` URL 或 Base64；适配器会物化来源并上传为当前企业的临时素材。已有 `media_id` 或 `wecom://media/{media_id}` 会直接复用，不会重复上传或降级成 URL 文本。
- `upload_file` 使用同一条临时素材管线并返回可直接发送的 `media_id`。素材格式和大小会在请求发出前按企业微信限制校验。
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

`wecom_call.path` 只接受不含 query/fragment 的绝对 API 路径，查询参数应单独放在 `query`。access token 自动缓存，并在企业微信报告失效时刷新且只重试一次；旧请求的迟到错误不会清空已经刷新的凭证。所有非零 `errcode` 都会抛出保留 `details`、`path` 与错误码的 `WeComApiError`。

## 底层接入

默认 Webhook、已有 Host 与消息队列最终进入同一个 `WeComClient`，共享事件校验、去重与 typed 分发：

```ts
const result = client.ingest(decryptedEvent);
const verified = client.ingestHttp({ method, query, body: rawXml });
const response = await client.acceptHttp(request);

const unsubscribe = client.onEvent("change_contact", event => {
  // 精确企业微信 Event 订阅
});
```

`WeComWebhookHost` 只负责 Koa 上下文桥接，不再持有第二套解密或去重状态。`ingestHttp()` 返回结构化 HTTP 响应，并在 POST 响应的 `ingest` 字段中附带 `{ accepted, duplicate, eventId, event }`。

已有 Host 已经完成验签解密，或事件来自可信队列时，可使用 manual 模式；此时无需回调 Token/AES Key，也不会在 OneBots Router 注册路由：

```yaml
wecom.internal_app:
  corp_id: ww1234567890abcdef
  corp_secret: your_application_secret
  agent_id: "1000001"
  receive_mode: manual
```

适配器不会自行监听端口。

事件统一保留 `raw_event`，其中 `RawXml` 是解密后的完整 XML，`EncryptedXml` 是收到的密文外层 XML。通讯录成员变更投影为 `user_added` / `user_updated` / `user_removed`；菜单、进入应用和模板卡片回调统一投影为 `interaction`，精确企业微信事件名保留在 `sub_type`。

[企业微信开发者中心](https://developer.work.weixin.qq.com/)
