# 钉钉适配器

`@onebots/adapter-dingtalk` 面向钉钉企业机器人，接收侧支持 Stream、HTTP 回调和手动接入，发送侧支持企业机器人 OpenAPI、会话 Webhook 与自定义群机器人。

## 安装

```bash
pnpm add @onebots/adapter-dingtalk
```

## Stream 配置

```yaml
dingtalk.my_bot:
  account_id: my_bot
  receive_mode: stream
  app_key: dingxxxxxxxx
  app_secret: xxxxxxxx
  robot_code: dingxxxxxxxx # 可省略，默认使用 app_key
  agent_id: "123456" # 仅工作通知需要
```

在钉钉开发者后台为应用添加机器人能力、启用 Stream 并发布。Stream 不需要公网回调地址，事件会在全部协议出口处理完成后确认；处理失败不会提交去重记录，平台重投仍可恢复。

## HTTP 与已有 Host

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

OneBots 托管的回调地址为 `POST /dingtalk/{account_id}/webhook`。适配器会完成签名校验、AES 解密、CorpId 校验和加密响应。

已有 HTTP Host、消息队列或测试连接应配置 `receive_mode: manual`：

- 已验证载荷调用 `await bot.ingest(rawEvent)`；
- Node Host 调用 `ingestHttp({ method, query, body })`；
- Fetch/WinterCG Host 调用 `await bot.acceptHttp(request)`；
- Koa Host 调用 `await bot.acceptHttp(ctx)`。

这些入口共享同一套验签、去重、并发控制和事件投影，不会由 SDK 另开端口。

## 消息与媒体资源

接收侧支持文本、富文本、图片、语音、视频和文件；发送侧支持文本、Markdown、图片 URL、链接与 ActionCard。入站媒体段同时包含：

```json
{
  "file": "<downloadCode>",
  "resource_id": "<downloadCode>",
  "download_code": "<downloadCode>"
}
```

把 `resource_id` 交给统一 `get_resource_temp_url`，适配器会调用钉钉 `/v1.0/robot/messageFiles/download` 并返回临时 HTTPS 地址。平台动作 `get_robot_message_file_download_url` 提供同一能力，参数为 `downloadCode` 与可选的 `robotCode`。

## 平台能力

适配器还提供企业机器人消息收发、撤回和已读状态，工作通知，用户/部门/角色管理，场景群与成员管理，以及互动卡片创建、投放、整体更新和 AI 流式更新。完整动作名称、参数和错误边界以[包 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-dingtalk)为准。

`call_dingtalk_api` 是受约束的底层入口：仅接受以 `/` 开头、不含目录穿越或 URL 查询语义的开放平台路径。稳定能力应优先使用命名动作。

## 相关链接

- [客户端 SDK 使用指南](/guide/client-sdk)
- [钉钉开放平台](https://open.dingtalk.com/)
- [钉钉 Stream Node.js SDK](https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs)
