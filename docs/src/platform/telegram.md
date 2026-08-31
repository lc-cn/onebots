# Telegram 适配器

Telegram 适配器已完全实现，支持通过 Telegram Bot API 接入 onebots 服务。

## 状态

✅ **已实现并可用**

## 功能特性

- ✅ **消息收发**
  - 私聊消息收发
  - 群组消息收发
  - 频道消息收发
  - 支持文本、图片、视频、音频、文件等多种消息格式
- ✅ **消息管理**
  - 消息编辑
  - 消息删除
- ✅ **群组管理**
  - 获取群组信息
  - 获取群组成员列表和信息
  - 离开群组
  - 踢出成员
- ✅ **交互功能**
  - Inline Keyboard（内联键盘）
  - Callback Query（回调查询）
  - 命令处理（/command）
- ✅ **连接模式**
  - 轮询模式（Polling，默认）
  - Webhook 模式

## 安装

```bash
npm install @onebots/adapter-telegram grammy
# 或
pnpm add @onebots/adapter-telegram grammy
```

## 配置

在 `config.yaml` 中配置 Telegram 账号：

```yaml
# Telegram 机器人账号配置
telegram.your_bot_id:
  # Telegram 平台配置
  token: 'your_telegram_bot_token'  # Telegram Bot Token，必填
  
  # 轮询模式（默认）
  polling:
    enabled: true  # 是否启用轮询，默认 true
    timeout: 30    # 轮询超时时间（秒）
    limit: 100     # 每次获取的更新数量
    allowed_updates: ['message', 'callback_query']  # 允许的更新类型
  
  # 或 Webhook 模式
  # webhook:
  #   url: 'https://your-domain.com/webhook'
  #   secret_token: 'your_secret_token'  # 可选，Webhook 密钥
  #   allowed_updates: ['message', 'callback_query']  # 允许的更新类型
  
  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'your_v11_token'
  
  # OneBot V12 协议配置
  onebot.v12:
    access_token: 'your_v12_token'
```

### 配置项说明

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `token` | string | 是 | Telegram Bot Token |
| `polling.enabled` | boolean | 否 | 是否启用轮询模式，默认 true |
| `polling.timeout` | number | 否 | 轮询超时时间（秒），默认 30 |
| `polling.limit` | number | 否 | 每次获取的更新数量，默认 100 |
| `polling.allowed_updates` | string[] | 否 | 允许的更新类型 |
| `webhook.url` | string | 否 | Webhook URL（Webhook 模式必填） |
| `webhook.secret_token` | string | 否 | Webhook 密钥 |
| `webhook.allowed_updates` | string[] | 否 | 允许的更新类型 |

## 获取 Bot Token

1. 在 Telegram 中搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 创建新机器人
3. 按照提示设置机器人名称和用户名
4. 获取 Bot Token（格式：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz-YourTokenHere`）

## 使用示例

### 启动服务

```bash
# 注册 Telegram 适配器和 OneBot V11 协议
onebots -r telegram -p onebot.v11
```

### 客户端 SDK 使用

onebots 提供了 imhelper 客户端SDK，可以方便地连接 Telegram 适配器：

```typescript
import { createImHelper } from 'imhelper';
import { createOnebot12Adapter } from '@imhelper/onebot-v12';

// 创建适配器
const adapter = createOnebot12Adapter({
  baseUrl: 'http://localhost:6727',
  selfId: 'your_bot_id',
  accessToken: 'your_token',
  receiveMode: 'ws',
  path: '/telegram/your_bot_id/onebot/v12',
  wsUrl: 'ws://localhost:6727/telegram/your_bot_id/onebot/v12',
  platform: 'telegram',
});

// 创建 ImHelper 实例
const helper = createImHelper(adapter);

// 监听消息事件
helper.on('message.private', (message) => {
  console.log('收到私聊消息:', message.content);
  message.reply([{ type: 'text', data: { text: '收到！' } }]);
});

helper.on('message.group', (message) => {
  console.log('收到群组消息:', message.content);
  message.reply([{ type: 'text', data: { text: '收到！' } }]);
});

// 连接
await adapter.connect();
```

详细说明请查看：[客户端SDK使用指南](/guide/client-sdk)

## 相关链接

- [Telegram Bot API 文档](https://core.telegram.org/bots/api)
- [Telegram Bot 开发文档](https://core.telegram.org/bots)
- [grammy 文档](https://grammy.dev/)
- [Telegram 适配器 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-telegram)

