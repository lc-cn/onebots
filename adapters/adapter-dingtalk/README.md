# @onebots/adapter-dingtalk

OneBots 的钉钉官方适配器。接收侧支持官方 Stream 长连接和 HTTP 回调；发送侧支持企业机器人主动消息、会话 Webhook 与自定义群机器人，三者不会再通过一个 `webhook_url` 开关混为同一模式。

## 安装

```bash
pnpm add @onebots/adapter-dingtalk
```

## 推荐配置：Stream

```yaml
dingtalk.my_bot:
  account_id: my_bot
  receive_mode: stream
  app_key: dingxxxxxxxx
  app_secret: xxxxxxxx
  robot_code: dingxxxxxxxx # 可省略，默认使用 app_key
  agent_id: "123456" # 仅工作通知 API 需要
```

在开发者后台为企业内部应用添加机器人能力、选择 Stream 模式并发布。Stream 不需要公网回调地址，断线后由钉钉官方 SDK 持续重连。

`DingTalkBot.start()` 是并发幂等的；启动期间调用 `stop()` 会使该代启动失效，延迟返回的令牌或连接不会再次触发 `ready`。Stream 首次连接失败会清理旧客户端，因此后续启动可以创建全新连接，而不会卡在未连接实例上。

事件处理完成后才会向 Stream 确认：这里的“完成”包含异步监听器与全部协议投递。机器人/卡片 CALLBACK 失败返回 `success: false`，普通 EVENT 失败返回 `LATER`。成功事件按 `msgId` 或 `eventId` 有界去重；处理失败不会提交去重记录，因此钉钉重投仍可恢复。缺少原生 ID 的 Webhook 会按 canonical JSON 载荷生成确定性身份，不再使用接收时钟。

高吞吐场景可配置 `max_pending_event_handlers` 与 `max_pending_callback_handlers`。Web 表单只在 Stream 模式显示这两个背压上限，只在 Webhook 模式显示回调验签字段，避免无关配置淹没必要信息。

## HTTP 加密回调

```yaml
dingtalk.my_bot:
  account_id: my_bot
  receive_mode: webhook
  app_key: dingxxxxxxxx
  app_secret: xxxxxxxx
  corp_id: dingxxxxxxxx
  token: callback-token
  encrypt_key: 43-character-EncodingAESKey
```

回调地址为：

```text
POST /dingtalk/{account_id}/webhook
```

适配器会验证 SHA-1 签名、解密 AES-256-CBC 载荷、校验 CorpId，并按钉钉要求返回加密响应。未配置 `encrypt_key` 时只接收带正确 `token` 的明文回调。

已有 HTTP Host、消息队列或测试连接可以配置 `receive_mode: manual`，再 `await DingTalkBot.ingest(rawEvent)` 进入同一校验、身份发现、并发合并、去重与事件投影链路，无需另开端口。Promise 成功表示本次 canonical 事件已经完成协议投递。

## 自定义群机器人

自定义机器人 Webhook 只负责向其所在的固定群发送消息，不会禁用企业通讯录 API，也不会改变事件接收方式：

```yaml
dingtalk.my_bot:
  account_id: my_bot
  receive_mode: webhook
  webhook_url: https://oapi.dingtalk.com/robot/send?access_token=xxxx
  webhook_secret: SECxxxxxxxx # 开启加签时填写
```

## 消息与事件

- 收消息：文本、富文本、图片、语音、视频和文件均投影为统一消息段。
- 发消息：文本、Markdown、图片 URL、链接和 ActionCard 映射为钉钉原生 `msgKey`。
- `@` 会映射到 `atUserIds` / `isAtAll`。
- 图片与链接必须是钉钉服务端可访问的无凭据 HTTP(S) URL；未知段、空消息和平台无法无损表达的混合消息会明确失败。
- Stream 收到的 `sessionWebhook` 会按会话及过期时间缓存，普通 `send_message` 优先复用它。
- 好友目录会递归读取应用可见的全部部门并按用户去重；群成员详情会先验证真实成员身份，不会把企业通讯录用户误报为群成员。
- 通讯录、群成员及未知原生事件均保留在 `raw_event`；尚未标准化的事件同时投影为 `custom` notice。

## 平台扩展动作

除统一 API 外，适配器通过 `callAction()` 提供结构化钉钉能力：

- `call_dingtalk_api`：底层开放平台入口，参数为 `path`、`method`、`auth`、`query`、`body`。
- `send_robot_private_message`、`send_robot_group_message`。
- `recall_robot_private_messages`、`recall_robot_group_messages`：按 `processQueryKeys` 撤回企业机器人消息。
- `get_robot_private_message_status`、`get_robot_group_message_status`：查询发送与已读状态。
- `send_work_notification`、`get_work_notification_result`、`recall_work_notification`。
- `get_user`、用户增删改、`get_department_users`、`get_sub_departments`、部门查询与增删改。
- `get_role_list`、`get_role_users`、用户角色增删。
- `get_scene_group`、场景群增改、场景群成员增删。

`auth` 可选 `modern`、`legacy`、`none`。路径必须是以 `/` 开头且不含目录穿越的开放平台路径。

统一 `delete_message` 同样支持企业机器人单聊和群聊撤回。`message_id` 必须是主动发送返回的 `processQueryKey`；群消息还需携带 `scene_type: "group"` 与群 `scene_id`。自定义机器人 Webhook 不返回该键，因此不会伪造“撤回成功”。成员增删和通讯录批量回调会逐用户生成 canonical notice，避免同一回调中的后续成员被漏掉。

## SDK 错误与事件类型

包入口导出 `DingTalkBot`、`DingTalkBotEvents`、`DingTalkError` 和 `DingTalkApiError`。Bot 的 `ready`、`stopped`、`robot_message`、`native_event`、`event`、`error` 均具有完整参数推断。

所有配置、消息编译、回调协议、资源、网络与开放平台失败均继承 OneBots 的 `OneBotsError`，可以使用稳定的 `code` 与 `category` 判断。`DingTalkApiError` 另行保留 `status`、`platformCode`、`requestId` 和 `path`；钉钉原始业务码不再占用 OneBots 的字符串 `code` 字段。

## 相关链接

- [钉钉开放平台](https://open.dingtalk.com/)
- [钉钉 Stream Node.js SDK](https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs)
- [自定义机器人文档](https://open.dingtalk.com/document/orgapp/custom-robot-access)
