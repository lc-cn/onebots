# Slack 适配器

Slack 适配器已完全实现，支持通过 Slack Bot API 接入 onebots 服务。

## 状态

✅ **已实现并可用**

## 功能特性

- ✅ **消息收发**
  - 频道消息收发
  - 单人私信与多人私信（MPIM）收发
  - 文本、文件、线程、Block Kit 与流式消息
  - 流式 `chunks`、任务 timeline/plan、Agent Session 状态与消息署名
- ✅ **消息管理**
  - 消息编辑
  - 消息删除
- ✅ **频道管理**
  - 获取频道列表和信息
  - 离开频道
  - 获取频道成员列表
- ✅ **用户管理**
  - 获取用户信息
- ✅ **事件订阅**
  - Socket Mode、HTTP Events 与 manual 接入
  - 事件只在同步/异步监听器成功后确认，失败可由 Slack 重投
- ✅ **扩展功能**
  - 应用命令（Slash Commands，需要额外配置）
  - 交互式组件、Canvas、Modal 与 App Home
  - Slack Lists、Calls 与远程文件索引/分享

## 安装

```bash
npm install @onebots/adapter-slack
# 或
pnpm add @onebots/adapter-slack
```

## 配置

在 `config.yaml` 中配置 Slack 账号：

```yaml
# Slack 机器人账号配置
slack.your_bot_id:
  # Slack 平台配置
  token: 'xoxb-your-bot-token'  # Slack Bot Token，必填
  receive_mode: socket  # socket（默认）、webhook 或 manual
  app_token: 'xapp-your-app-token'  # Socket Mode 必填
  
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
| `token` | string | 是 | Slack Bot Token（xoxb-...） |
| `receive_mode` | socket / webhook / manual | 否 | 唯一事件接收方式，默认 socket |
| `signing_secret` | string | Webhook 模式 | Signing Secret（用于验证请求） |
| `app_token` | string | Socket 模式 | App-Level Token（用于 Socket Mode） |

## 获取 Bot Token

1. 访问 [Slack API](https://api.slack.com/)
2. 创建应用（Create New App）
3. 在 "OAuth & Permissions" 中配置权限：
   - `chat:write` - 发送消息
   - `channels:read` - 读取频道信息
   - `channels:history` - 读取频道历史
   - `users:read` - 读取用户信息
   - `im:read` - 读取私聊
   - `im:write` - 发送私聊消息
4. 安装应用到工作区
5. 获取 Bot User OAuth Token（xoxb-...）
6. Webhook 模式下，在 "Event Subscriptions" 中配置 HTTPS URL：`https://your-server/slack/{account_id}/webhook`
7. 获取 Signing Secret（用于验证请求）

## 使用示例

### 启动服务

```bash
# 注册 Slack 适配器和 OneBot V11 协议
onebots -r slack -p onebot.v11
```

### 客户端 SDK 使用

onebots 提供了 imhelper 客户端SDK，可以方便地连接 Slack 适配器：

```typescript
import { createOnebot12Client } from '@imhelper/onebot-v12';

const client = createOnebot12Client({
  baseUrl: 'http://localhost:6727/slack/your_bot_id/onebot/v12',
  selfId: 'your_bot_id',
  accessToken: 'your_token',
  receiveMode: 'ws',
});

// 监听消息事件
client.on('message.private', async message => {
  console.log('收到私聊消息:', message.content);
  await message.reply('收到！');
});

client.on('message.channel', async message => {
  console.log('收到频道消息:', message.content);
  await message.reply('收到！');
});

await client.start();
```

详细说明请查看：[客户端SDK使用指南](/guide/client-sdk)

## 相关链接

- [Slack API 文档](https://api.slack.com/)
- [Slack Bot 开发文档](https://api.slack.com/bot-users)
- [@slack/web-api 文档](https://slack.dev/node-slack-sdk/web-api)
- [Slack 适配器 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-slack)
