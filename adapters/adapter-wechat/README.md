# @onebots/adapter-wechat

OneBots 的微信公众平台官方 API 适配器。它复用 OneBots HTTP Host 接收 Webhook，支持明文与安全模式、用户私聊、被动回复、客服消息以及公众号原生管理 API。

## 配置

```yaml
wechat.my_mp:
  app_id: wx1234567890abcdef
  app_secret: your_app_secret
  receive_mode: webhook
  token: your_webhook_token
  encoding_aes_key: your_43_character_key # 安全/兼容模式必填
  passive_reply_timeout_ms: 4500
  deduplicate_webhooks: true

  onebot.v11:
    use_http: true
    use_ws: true
```

公众平台的服务器地址填写：

```text
https://bot.example.com/wechat/my_mp/webhook
```

默认路径为 `/wechat/{account_id}/webhook`，可用 `webhook_path` 覆盖。`token` 与 `encoding_aes_key` 必须和公众平台配置一致。

如事件已由既有 HTTP Host、消息队列或测试夹具接收，可改用 `receive_mode: manual`。此时适配器不注册 Webhook 路由。将已验证并解析的 `WechatIncomingMessage` 交给 `WechatClient.ingest()` 时不要求回调 `token`；若现有 Host 要复用 `WechatWebhookHost.acceptHttp(Request|ctx)` 的验签、解密和被动回复编码，则仍需配置 Token/AES Key，Web 表单会在 manual 模式提供。Webhook 与 manual 共用 Client 内的稳定身份、进行中合并、去重和 typed 分发；无损、分类与精确事件视图的同步或异步监听器都会完成尝试，任一失败都不会污染去重状态。`onEvent(name, listener)` 可按微信原生 `Event` 精确订阅，并返回取消订阅函数。

## 消息

- 接收文本、图片、语音（含识别结果）、视频、短视频、位置和链接。
- 接收所有公众号事件；关注/取关、菜单与扫码交互、模板和群发状态会分别投影为统一的 `friend_add`/`friend_remove`、`interaction`、`message_status`，精确微信事件名保留在 `sub_type`，完整解析结果与原始 XML 保存在 `raw_event`。
- 发送文本、图片、语音、视频、图文及 `wechat_message` 原生消息。
- 图片、语音和视频可直接使用 HTTPS URL、本地路径、`data:` URL 或 Base64；适配器会上传为当前公众号的临时素材。已有 `media_id`、`file_id` 或 `wechat://media/{media_id}` 会优先复用，入站段携带的 URL 仅作为元数据。
- 客服视频需要 `thumb_media_id`，也可用 `thumb_url`、`thumb_path`、`thumb_data` 或 `thumb` 自动上传 JPG 缩略图；被动回复仍遵循微信原生视频格式。
- `reply` 段的 `message_id`/`event_id` 会在当前 Webhook 窗口内产生被动回复；窗口失效后改走客服消息。

```ts
await adapter.sendMessage("my_mp", {
  scene_type: "private",
  scene_id: adapter.resolveId("user_openid"),
  message: [{ type: "text", data: { text: "你好" } }],
});
```

微信公众号没有群聊。用户标签是受众管理能力，不会伪装为 `group`。

## 原生 API

常用能力通过 `callAction(accountId, action, params)` 暴露，包括：

- 用户、标签、黑名单与备注；
- 临时/永久素材、草稿与发布；
- 普通/个性化菜单、二维码；
- 模板消息、客服输入状态与群发；
- API 配额查询/清理、RID 请求诊断、API 域名与回调 IP 查询。
- 多客服账号、头像、在线状态、绑定邀请、客服会话和消息记录。

登录信息与事件 `bot_id` 统一使用公众号实际 `app_id`，`account_id` 只作为 OneBots 内部配置键，不再暴露成平台身份。多客服接口依赖公众号已开通对应客服能力；不可用时微信的结构化错误会原样返回。

关注者目录会完整分页、按 openid 去重并检测停滞游标，避免异常响应导致同步永久循环或重复拉取用户资料。

`wechat_call` 可调用新增或低频接口：

```ts
await adapter.callAction("my_mp", "wechat_call", {
  method: "POST",
  path: "/cgi-bin/menu/create",
  body: { button: [] },
});
```

路径必须以 `/` 开头，查询参数必须通过 `query` 提供；适配器拒绝绝对 URL、路径穿越、内嵌 query/fragment。access token 使用微信稳定版 `/cgi-bin/stable_token`，普通刷新不会使其他进程正在使用的凭据失效；平台报告凭据失效时才执行一次强制刷新和重试，迟到的旧请求不会清空已经刷新的 token。

## 底层接入

`WechatWebhookHost.ingest()` 返回结构化 HTTP 响应，`acceptHttp()` 可直接接收标准 `Request` 或挂到已有 Koa 风格 Host；`WechatClient.ingest()` 则允许现有连接把含稳定收发方、时间与消息 ID 的解析事件交给同一个客户端。Webhook Host 只负责验签、解密和被动回复编码，不再持有第二套投递状态。适配器本身不会另开端口。

## 权限

公众号类型、认证状态与已申请接口权限会决定 API 是否可用。适配器不会根据账号类型猜测并禁用接口，微信返回的结构化错误会原样保留在 `WechatApiError.details`。

[微信公众平台开发文档](https://developers.weixin.qq.com/doc/offiaccount/Getting_Started/Overview.html)
