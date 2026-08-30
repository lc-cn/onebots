# @onebots/adapter-telegram

OneBots 的 Telegram Bot API 适配器。基于 grammY 1.46 / Telegram Bot API 10.0，支持 polling、webhook、代理、完整原始 Update 透传，以及可由所有已启用协议调用的平台扩展动作。

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
- ✅ Bot API 扩展动作：投票、转发/复制、完整 ReactionType、置顶、邀请链接与群权限
- ✅ Forum Topic 完整生命周期：创建、编辑、关闭、重开、删除与清理置顶
- ✅ Bot 命令、名称、长短描述、菜单按钮与默认管理员权限
- ✅ Callback、Inline、Shipping 与 Pre-checkout 查询应答
- ✅ Guest Mode：`guest_message` 标准消息投影与 `answer_guest_query` 原生回复
- ✅ 生成中止、托管 Bot、用户订阅状态等 Bot API 10.0 Update 投影
- ✅ Callback/Inline/支付查询、消息编辑、机器人群生命周期、成员变化、入群申请的标准事件投影
- ✅ 成员受限状态按 Bot API 的 `restricted.is_member` 判定真实加入/退出，不把全部 restricted 用户误算为在群
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

扩展动作按消息、聊天/论坛、Bot 管理和交互应答四个领域组织，并全部进入同一不可变能力注册表。`set_message_reaction` 同时接受 emoji 字符串与官方 `ReactionType` 对象，因此 custom emoji 不会被压扁。Guest Mode 收到的 `extensions.telegram.guest_query_id` 可直接交给 `answer_guest_query`，其 `result` 使用官方 `InlineQueryResult` 结构。完整动作可通过 `get_supported_actions` 动态查询；未来 Bot API 仍可由 `call_telegram_api` 无损调用。

高级集成可直接构造 `TelegramBot`，通过 `await ingest(rawUpdate)` 把现有 HTTP 服务、队列或测试夹具收到的 Update 交给同一 grammY 中间件和去重链；Fetch / WinterCG Host 可直接调用 `acceptHttp(request)`，复用 secret 校验和结构化响应。`raw_update` 保留每次投递；canonical 与细分事件、全部协议出口都成功后才提交 `update_id`。失败的 Webhook 返回 500，polling 会重新拉取；相同 Update 的并发投递只执行一次。所有原生调用可经 `callApi(method, task)` 获得统一的 `TelegramError`，其中包含 Telegram `error_code`、`retry_after` 和 `migrate_to_chat_id`。

`stop()` 会先终止当前接收代次，再完整等待 polling、远端 Webhook 删除和全部停止监听器；单一步骤失败不会跳过其余清理，最终保留精确的结构化步骤错误，多个步骤失败时汇总为 `TELEGRAM_STOP_FAILED`。

`start()` 只有在异步 `ready` 消费者全部成功后才确认完成；若投影失败，会终止本代 polling 或删除刚安装的远端 Webhook，再传播结构化启动错误，修复后可在同一实例上重新启动。

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
