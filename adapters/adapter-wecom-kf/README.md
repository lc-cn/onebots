# @onebots/adapter-wecom-kf

OneBots 的企业微信“微信客服”官方 API 适配器。它通过加密回调触发 `kf/sync_msg`，用 `kf/send_msg` 回复客户，并提供客服账号、接待人员、会话分配、升级服务与统计管理能力。

> 本包不是 `@onebots/adapter-wecom`。后者处理企业自建应用消息与 `appchat`，两套产品模型和 Secret 不混用。

## 配置

```yaml
wecom-kf.customer_service:
  corp_id: ww1234567890abcdef
  corp_secret: your_wecom_customer_service_secret
  token: your_callback_token
  encoding_aes_key: your_43_character_key
  receive_mode: webhook
  open_kfid: wkxxxxxxxxxxxxxxxx # 可选默认客服账号
  cursor_store_path: ./data/wecom-kf-cursor.json
  deduplicate_messages: true

  onebot.v11:
    use_http: true
    use_ws: true
```

`corp_secret` 是微信客服 API 页面生成的 Secret。临时素材上传不需要 `agent_id`，旧配置中的该字段不再使用。

在微信客服“接收消息”中填写 `https://bot.example.com/wecom-kf/customer_service/webhook`。默认路径为 `/wecom-kf/{account_id}/webhook`，可用 `webhook_path` 覆盖。适配器只接受验签、解密且 CorpID 匹配的官方加密 XML，不接受明文或 JSON 兼容载荷。

## 同步与事件

- `kf_msg_or_event` 回调中的 `Token` 和 `OpenKfId` 会触发对应客服账号的 `sync_msg`。
- 回调在验签、解密和字段校验后立即确认；分页同步进入后台队列，错误通过 `client_error` 与适配器日志报告。
- 同一客服账号的同步请求串行执行，分页必须推进游标，避免并发回调覆盖进度。
- 游标使用异步临时文件加原子重命名持久化；损坏或不可写不会被静默忽略。
- `start()` 幂等；`stop()` 会中止在途同步，快速重启使用 generation 隔离旧请求。
- 客户消息、接待人员消息、平台事件和未知消息类型都会保留完整 `raw_event`。
- `sync_msg` 的事件身份从官方 `event.open_kfid/external_userid` 读取，不再误依赖消息顶层字段。
- 回调 `Token`、解密明文和加密 XML 只留在接入层，不会随协议事件发送给下游。
- 业务事件只有在全部 canonical 监听器成功返回后才写入去重窗口并提交游标；监听器异常会保留旧游标，让后续 `sync_msg` 重投。
- 接待人员消息的 `sender.id` 是真实 `servicer_userid`，客户身份保留在 `extensions.wecom_kf.external_userid`。
- 可选 `enable_sync_poll` 仅作无回调 Token 时的补偿；默认关闭，开启时必须配置 `open_kfid`。

## 消息

通用发送支持文本、图片、语音、视频、文件、图文链接、位置、小程序与菜单。媒体段必须使用 `media_id` / `file_id`，可先调用标准 `upload_file` 或 `upload_temporary_media`。未知段会明确报错，不会发送 `[type]` 占位文本。

`wecom_kf_message` 可传任意官方原生消息体，但标准发送目标、客服账号和消息 ID 由客户端统一控制：

```ts
await adapter.sendMessage("customer_service", {
  scene_type: "private",
  scene_id: customerId,
  message: [
    {
      type: "wecom_kf_message",
      data: {
        msgtype: "msgmenu",
        msgmenu: {
          head_content: "请选择",
          list: [{ type: "click", click: { id: "help", content: "帮助" } }],
        },
      },
    },
  ],
});
```

## 原生动作

平台动作覆盖：

- 客服账号：列表、详情、新增、更新、删除、获取客服链接；
- 接待人员：添加、删除、列表；
- 会话：查询状态、变更状态、手动同步；
- 客户：批量详情、升级服务、取消升级；
- 消息：原生发送、事件欢迎语/提示语、临时素材上传下载；
- 数据：企业汇总、接待人员统计与视频号绑定状态。
- 知识库：分组与问答的新增、修改、删除和分页查询。

分组动作是 `add_knowledge_group`、`update_knowledge_group`、`delete_knowledge_group` 和 `list_knowledge_groups`；问答动作使用对应的 `*_knowledge_intent` 名称，其中列表为 `list_knowledge_intents`。复杂问答内容通过 `request` 原样使用官方结构，例如 `add_knowledge_intent` 接收 `{ request: { group_id, question, similar_questions, answers } }`；路径、方法、凭证与错误仍由 Client 统一处理。知识库接口遵循官方权限边界，目前应使用已配置到“微信客服-可调用接口的应用”的自建应用凭证。

`wecom_kf_call` 为新增或低频接口提供统一 token、HTTPS Base URL、受限 API 路径和结构化错误。所有 JSON 响应都会先验证官方 `errcode/errmsg` envelope；账号、客户、同步消息、会话状态和素材响应还会校验对应结构，畸形成功响应不会再被强制断言成目标类型：

```ts
await adapter.callAction("customer_service", "wecom_kf_call", {
  method: "POST",
  path: "/cgi-bin/kf/get_corp_statistic",
  body: { open_kfid: "wk...", start_time: 1788105600, end_time: 1788192000 },
});
```

`path` 不得内嵌 query/fragment，查询参数应通过 `query` 提供。凭证刷新按请求实际使用的 token 代次失效，旧请求迟到时不会清空已经刷新的凭证。

## 底层接入

- `WeComKfWebhookHost.ingest()` 接收框架无关请求并返回结构化 HTTP 响应；
- `WeComKfWebhookHost.acceptHttp()` 可挂到已有 Koa 风格 Host；
- `WeComKfClient.ingest()` 可接收已有连接或其他同步器取得的原始 `sync_msg` 条目；
- `WeComKfClient.call()` 对 JSON 与二进制响应提供闭合重载；JSON 返回 `KfJsonResponse`，素材下载返回 `Buffer`。

已有 Host 或同步器负责接收事件时，可使用 manual 模式；OneBots 不注册 Webhook 路由，回调 Token/AES Key 也不再是必填项：

```yaml
wecom-kf.customer_service:
  corp_id: ww1234567890abcdef
  corp_secret: your_wecom_customer_service_secret
  receive_mode: manual
  open_kfid: wkxxxxxxxxxxxxxxxx
  enable_sync_poll: true
```

manual 模式仍可按需构造 `WeComKfWebhookHost` 处理原始加密回调，或直接使用 `client.ingest(item)` 接入已有 `sync_msg` 同步器；所有条目继续进入同一个 typed Client 事件管线。

适配器不会自行监听端口。发送窗口、5 条限制与“接口成功不等于最终送达”均由微信客服规则决定，最终失败通过 `sync_msg` 事件交付。

[企业微信开发者中心：微信客服](https://developer.work.weixin.qq.com/document/path/94638)
