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
- 通讯录、群成员及未知原生事件均保留在 `raw_event`；尚未标准化的事件同时投影为 `custom` notice。

## 平台扩展动作

除统一 API 外，适配器通过 `callAction()` 提供结构化钉钉能力：

- `call_dingtalk_api`：底层开放平台入口，参数为 `path`、`method`、`auth`、`query`、`body`。
- `send_robot_private_message`、`send_robot_group_message`。
- `send_work_notification`、`get_work_notification_result`、`recall_work_notification`。
- `get_department_users`、`get_sub_departments`、部门增删改。
- `get_role_list`、`get_role_users`、用户角色增删。

`auth` 可选 `modern`、`legacy`、`none`。路径必须是以 `/` 开头且不含目录穿越的开放平台路径。

## 相关链接

- [钉钉开放平台](https://open.dingtalk.com/)
- [钉钉 Stream Node.js SDK](https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs)
- [自定义机器人文档](https://open.dingtalk.com/document/orgapp/custom-robot-access)
