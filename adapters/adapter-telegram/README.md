# @onebots/adapter-telegram

OneBots 的 Telegram Bot API 适配器。支持 polling、webhook、代理、完整原始 Update 透传，以及可由所有已启用协议调用的平台扩展动作。

## 安装

```bash
npm install @onebots/adapter-telegram grammy
# 或
pnpm add @onebots/adapter-telegram grammy
```

## 配置

在 `config.yaml` 中配置：

```yaml
telegram.your_bot_id:
  token: "YOUR_BOT_TOKEN"

  # polling（默认）或 webhook；Web 表单会只显示当前模式相关字段
  receive_mode: polling

  # 代理配置（可选，用于访问 Telegram API）
  proxy:
    url: "http://127.0.0.1:7890" # 或 socks5://127.0.0.1:1080
    # username: "user"  # 可选
    # password: "pass"  # 可选

  # 轮询模式（默认）
  polling:
    timeout: 30
    limit: 100
    drop_pending_updates: false
    allowed_updates: ["message", "callback_query", "chat_member"]
  # 或 Webhook 模式
  # receive_mode: webhook
  # webhook:
  #   # Telegram 实际请求地址；通常指向 OneBots 账号的 /telegram/<account_id>/webhook
  #   url: "https://your-domain.com/telegram/your_bot_id/webhook"
  #   secret_token: "your_secret_token"
  #   max_connections: 40
  #   # ip_address: "149.154.167.220"
  #   drop_pending_updates: false
  #   allowed_updates: ["message", "callback_query"]
```

`receive_mode` 是接收方式的唯一来源。选择 `webhook` 时必须配置 HTTPS `webhook.url` 和随机 `secret_token`；切换到 `polling` 时会主动删除 Telegram 侧旧 Webhook，避免 `getUpdates` 持续冲突。Web 管理端按模式动态显示字段，更新类型、待处理更新策略、Webhook 连接数和固定来源 IP 均可直接配置，不需要手写 JSON。

### 代理配置说明

| 配置项           | 类型   | 必填 | 说明           |
| ---------------- | ------ | ---- | -------------- |
| `proxy.url`      | string | 是   | 代理服务器地址 |
| `proxy.username` | string | 否   | 代理用户名     |
| `proxy.password` | string | 否   | 代理密码       |

支持的代理类型：

- HTTP 代理：`http://host:port`
- HTTPS 代理：`https://host:port`
- SOCKS4/5 代理：`socks4://host:port`、`socks5://host:port`

## 使用

```bash
onebots -r telegram
```

## 能力

- ✅ 私聊消息收发
- ✅ 群组消息收发
- ✅ 频道消息收发
- ✅ 图片、视频、音频、文件发送
- ✅ 消息编辑和删除
- ✅ 群组管理：踢出/禁言成员、设置管理员、群名、管理员头衔、处理入群申请
- ✅ Bot API 扩展动作：投票、转发/复制、Reaction、置顶、邀请链接、群描述
- ✅ Callback/Inline/支付查询、消息编辑、成员变化、入群申请的标准事件投影
- ✅ Reaction 增删与批量商业消息删除会拆成独立、唯一 ID 的标准事件
- ✅ 其他 Telegram Update 以 `notice.custom` + `raw_event` 无损交付
- ✅ **代理支持**（HTTP/HTTPS/SOCKS4/SOCKS5）

媒体段可直接使用 Telegram `file_id` 或 HTTP(S) URL；本地路径、`file://`、data URL 与 `base64://` 会物化为 grammY `InputFile` 原生上传。未知段、无效回复、空位置/联系人和平台无法表达的内容会明确失败，不会退化为空文本请求。统一 `update_message` 只更新文本和 @；媒体、Caption 或键盘更新请使用 `call_telegram_api` 调用相应 Bot API 方法。

能力列表可通过协议的 `get_supported_actions` 查询。平台扩展动作使用 snake_case，例如 `send_poll`：

```json
{
  "action": "send_poll",
  "params": {
    "chat_id": -100123456,
    "question": "选择一个版本",
    "options": ["稳定版", "预览版"]
  }
}
```

当前扩展动作包括：`send_poll`、`forward_message`、`copy_message`、 `set_message_reaction`、`pin_message`、`unpin_message`、 `create_chat_invite_link`、`set_chat_description`。

高级集成可直接构造 `TelegramBot`，通过 `ingest(rawUpdate)` 把现有 HTTP 服务、队列或测试夹具收到的 Update 交给同一 grammY 中间件和去重链；`raw_update` 保留每次投递，`update` 仅投递去重后的业务事件。所有原生调用可经 `callApi(method, task)` 获得统一的 `TelegramError`，其中包含 Telegram `error_code`、`retry_after` 和 `migrate_to_chat_id`。

## 获取 Bot Token

1. 在 Telegram 中搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 创建新机器人
3. 按照提示设置机器人名称和用户名
4. 获取 Bot Token

### 常见问题

#### 1. 连接超时 / Network request failed

如果你在中国大陆等需要代理的地区访问 Telegram API，请配置代理：

```yaml
telegram.your_bot:
  token: "xxx"
  proxy:
    url: "http://127.0.0.1:7890" # 你的代理地址
```

#### 2. 代理配置后仍然超时

1. 确认代理服务正常运行
2. 检查代理地址和端口是否正确
3. 确认代理服务允许访问 `api.telegram.org`

可以用以下命令测试代理：

```bash
curl -x http://127.0.0.1:7890 https://api.telegram.org/bot<TOKEN>/getMe
```

## 相关链接

- [Telegram Bot API 文档](https://core.telegram.org/bots/api)
- [grammy 文档](https://grammy.dev/)
- [onebots 文档](https://onebots.pages.dev/)
