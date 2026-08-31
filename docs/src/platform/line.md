# Line 适配器

Line 适配器支持通过 Line Messaging API 接入 onebots 服务。

## 状态

✅ **已实现并可用**

## 功能特性

- ✅ **消息收发**
  - 私聊消息收发
  - 群组消息收发
  - 聊天室消息收发
  - 支持文本、图片、视频、音频、文件、位置、贴图等多种消息格式
- ✅ **消息管理**
  - 回复消息
  - 推送消息
- ✅ **用户管理**
  - 获取用户资料
  - 获取群组成员资料
  - 获取聊天室成员资料
- ✅ **群组管理**
  - 获取群组信息
  - 获取群组成员列表
  - 离开群组
- ✅ **聊天室管理**
  - 获取聊天室成员列表
  - 离开聊天室
- ✅ **事件处理**
  - 消息事件
  - 关注/取消关注事件
  - 加入/离开群组事件
  - 成员加入/离开事件
  - Postback 事件
- ✅ **代理支持**
  - HTTP/HTTPS 代理
  - 支持代理认证

## 安装

```bash
npm install @onebots/adapter-line
# 或
pnpm add @onebots/adapter-line
```

如果需要代理支持，请安装可选依赖：

```bash
npm install https-proxy-agent
```

## 配置

在 `config.yaml` 中配置 Line 账号：

```yaml
# Line 机器人账号配置
line.your_bot_id:
  # Line 平台配置
  channel_access_token: 'your_channel_access_token'  # Channel Access Token，必填
  channel_secret: 'your_channel_secret'              # Channel Secret，必填
  
  # 可选配置
  webhook_path: '/line/your_bot_id/webhook'  # 自定义 Webhook 路径
  
  # 代理配置（可选）
  proxy:
    url: 'http://127.0.0.1:7890'  # 代理服务器地址
    username: 'proxy_user'        # 代理用户名（可选）
    password: 'proxy_pass'        # 代理密码（可选）
  
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
| `channel_access_token` | string | 是 | Line Channel Access Token |
| `channel_secret` | string | 是 | Line Channel Secret |
| `webhook_path` | string | 否 | 自定义 Webhook 路径 |
| `proxy.url` | string | 否 | 代理服务器地址 |
| `proxy.username` | string | 否 | 代理用户名 |
| `proxy.password` | string | 否 | 代理密码 |

## 获取 Channel Access Token 和 Channel Secret

1. 访问 [Line Developers Console](https://developers.line.biz/console/)
2. 创建一个 Provider（如果还没有）
3. 创建一个新的 Messaging API Channel
4. 在 Channel 的 "Basic settings" 页面获取 **Channel Secret**
5. 在 Channel 的 "Messaging API" 页面生成或获取 **Channel Access Token**

## Webhook 配置

Line 适配器使用 Webhook 模式接收消息。启动服务后，需要在 Line Developers Console 中配置 Webhook URL：

1. 在 Line Developers Console 中进入你的 Channel
2. 在 "Messaging API" 页面找到 "Webhook settings"
3. 设置 Webhook URL 为：
   ```
   https://your-domain.com/line/{account_id}/webhook
   ```
   例如：
   ```
   https://bot.example.com/line/my_bot/webhook
   ```
4. 点击 "Verify" 验证 Webhook
5. 启用 "Use webhook"

::: warning 注意
- Webhook URL 必须是 HTTPS
- 确保你的服务器可以从公网访问
- 建议在生产环境使用反向代理（如 Nginx）
:::

## 使用示例

### 启动服务

```bash
# 注册 Line 适配器和 OneBot V11 协议
onebots -r line -p onebot.v11
```

### 客户端 SDK 使用

onebots 提供了 imhelper 客户端SDK，可以方便地连接 Line 适配器：

```typescript
import { createImHelper } from 'imhelper';
import { createOnebot12Adapter } from '@imhelper/onebot-v12';

// 创建适配器
const adapter = createOnebot12Adapter({
  baseUrl: 'http://localhost:6727',
  selfId: 'your_bot_id',
  accessToken: 'your_token',
  receiveMode: 'ws',
  path: '/line/your_bot_id/onebot/v12',
  wsUrl: 'ws://localhost:6727/line/your_bot_id/onebot/v12',
  platform: 'line',
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

## 支持的消息类型

### 发送消息

| 类型 | 说明 |
|------|------|
| text | 文本消息 |
| image | 图片消息 |
| video | 视频消息 |
| audio | 音频消息 |
| file | 文件消息 |
| location | 位置消息 |
| sticker | 贴图消息 |

### 接收消息

| 类型 | 说明 |
|------|------|
| text | 文本消息 |
| image | 图片消息 |
| video | 视频消息 |
| audio | 音频消息 |
| file | 文件消息 |
| location | 位置消息 |
| sticker | 贴图消息 |

## 相关链接

- [Line Messaging API 文档](https://developers.line.biz/en/docs/messaging-api/)
- [Line Developers Console](https://developers.line.biz/console/)
- [Line 适配器 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-line)

