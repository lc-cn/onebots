# 钉钉适配器配置

钉钉适配器把事件接收方式与消息发送凭据分开配置。默认使用官方 Stream 长连接；HTTP 回调与嵌入已有 Host 也使用同一套事件投影和去重链路。

## 事件接收方式

| `receive_mode` | 行为 |
|----------------|------|
| `stream` | 默认值。由 OneBots 建立钉钉 Stream 长连接，不需要公网回调地址 |
| `webhook` | 挂载账号 HTTP 回调路由，由钉钉推送事件 |
| `manual` | 不创建连接或路由，由嵌入式 Host 调用 `bot.ingest()` / `bot.acceptHttp()` |

`webhook_url` 只是固定群自定义机器人的发送出口，不会改变 `receive_mode`，也不能替代企业机器人接收事件。

## 配置字段

| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `account_id` | string | OneBots 内部账号标识 | 必填 |
| `receive_mode` | `stream` \| `webhook` \| `manual` | 事件接收方式 | `stream` |
| `app_key` | string | Client ID / AppKey；Stream 和开放平台 API 使用 | - |
| `app_secret` | string | Client Secret / AppSecret | - |
| `robot_code` | string | 企业机器人编码；留空时使用 `app_key` | - |
| `agent_id` | string | 工作通知等企业内部应用 API 使用 | - |
| `corp_id` | string | 加密 HTTP 回调的企业 ID | - |
| `token` | string | HTTP 回调签名 Token | - |
| `encrypt_key` | string | HTTP 加密回调的 43 字符 EncodingAESKey | - |
| `max_pending_event_handlers` | number | Stream EVENT 在途处理上限，范围 1–10000 | `100` |
| `max_pending_callback_handlers` | number | Stream CALLBACK 在途处理上限，范围 1–10000 | `100` |
| `webhook_url` | string | 固定群自定义机器人 HTTPS 发送地址 | - |
| `webhook_secret` | string | 自定义机器人加签密钥 | - |

## Stream 长连接

```yaml
dingtalk.my_bot:
  receive_mode: stream
  app_key: 'your_app_key'
  app_secret: 'your_app_secret'
  robot_code: 'your_robot_code' # 可选，默认使用 app_key
  max_pending_event_handlers: 100
  max_pending_callback_handlers: 100

  onebot.v11:
    access_token: 'your_v11_token'
```

在钉钉开放平台创建应用并获取 AppKey/AppSecret，订阅 Stream 事件后即可连接。达到并发上限时，适配器不会无界累积任务：EVENT 会请求平台稍后重投，CALLBACK 会等待服务端重投。

## HTTP 回调

```yaml
dingtalk.my_bot:
  receive_mode: webhook
  app_key: 'your_app_key'
  app_secret: 'your_app_secret'
  corp_id: 'ding_corp_id'
  token: 'callback_token'
  encrypt_key: '43_character_encoding_aes_key_here______'
```

账号路由为：

```text
https://your-domain.example/dingtalk/my_bot/webhook
```

生产环境应通过 HTTPS 反向代理公开该路由。启用 `encrypt_key` 时必须同时配置 `corp_id`；适配器会校验签名、解密请求并返回加密响应。

## 自定义机器人发送

```yaml
dingtalk.my_bot:
  receive_mode: manual
  webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN'
  webhook_secret: 'SEC...'
```

该配置只提供固定群发送能力。请把配置文件视为敏感数据，避免在日志、命令行或文档中暴露 URL 内的 access token。

## 启动超时与取消

钉钉账号启动、Stream 握手、访问令牌校验和后续协议出口共用 OneBots 全局 `timeout`。超时、人工停止或配置热重载取消启动时，适配器会中止令牌请求、断开尚未完成的 Stream，并阻止忽略取消的迟到响应缓存令牌或恢复在线状态。账号就绪后，取消信号会保留到协议出口完成，因此协议启动失败也能完整回滚账号连接。

## 相关链接

- [适配器配置指南](/guide/adapter)
- [钉钉平台文档](/platform/dingtalk)
