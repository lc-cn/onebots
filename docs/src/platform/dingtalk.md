# 钉钉适配器

钉钉适配器已完全实现，支持通过钉钉机器人接入 onebots 服务。

## 状态

✅ **已实现并可用**

## 功能特性

### 企业内部应用模式

- ✅ **消息收发**
  - 单聊消息收发
  - 群聊消息收发
  - 支持文本、Markdown、卡片等多种消息格式
- ✅ **用户管理**
  - 获取用户信息
- ✅ **事件订阅**
  - Webhook 事件订阅
  - 自动 Token 管理

### 自定义机器人模式（Webhook）

- ✅ **群聊消息推送**
  - 文本消息
  - Markdown 消息
  - @用户、@所有人
  - 卡片消息（部分支持）

## 安装

```bash
npm install @onebots/adapter-dingtalk
# 或
pnpm add @onebots/adapter-dingtalk
```

## 配置

### 企业内部应用模式

在 `config.yaml` 中配置：

```yaml
# 钉钉企业内部应用机器人配置
dingtalk.your_bot_id:
  # 钉钉平台配置
  app_key: 'your_app_key'  # 应用 AppKey，必填
  app_secret: 'your_app_secret'  # 应用 AppSecret，必填
  agent_id: 'your_agent_id'  # 可选，企业内部应用的 AgentId
  encrypt_key: 'your_encrypt_key'  # 可选，事件加密密钥
  token: 'your_token'  # 可选，事件验证 Token
  
  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'your_v11_token'
  
  # OneBot V12 协议配置
  onebot.v12:
    access_token: 'your_v12_token'
```

### 自定义机器人模式（Webhook）

在 `config.yaml` 中配置：

```yaml
# 钉钉自定义机器人配置
dingtalk.your_bot_id:
  # 钉钉平台配置
  webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN'
  
  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'your_v11_token'
```

### 配置项说明

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `app_key` | string | 是* | 应用 AppKey（企业内部应用模式必填） |
| `app_secret` | string | 是* | 应用 AppSecret（企业内部应用模式必填） |
| `agent_id` | string | 否 | 企业内部应用的 AgentId |
| `encrypt_key` | string | 否 | 事件加密密钥 |
| `token` | string | 否 | 事件验证 Token |
| `webhook_url` | string | 是* | Webhook URL（自定义机器人模式必填） |

*注：企业内部应用模式和自定义机器人模式二选一，不能同时使用。

## 获取应用凭证

### 企业内部应用

1. 访问 [钉钉开放平台](https://open.dingtalk.com/)
2. 创建企业内部应用
3. 获取 `AppKey` 和 `AppSecret`
4. 获取 `AgentId`（可选）
5. 配置事件订阅 URL（Webhook）：`http://your-server:port/dingtalk/{account_id}/webhook`
6. 配置应用权限（消息收发、通讯录等）

### 自定义机器人

1. 在钉钉群聊中，点击"群设置" -> "智能群助手" -> "添加机器人"
2. 选择"自定义"机器人
3. 获取 Webhook URL

## 使用示例

### 启动服务

```bash
# 注册钉钉适配器和 OneBot V11 协议
onebots -r dingtalk -p onebot.v11
```

### 客户端 SDK 使用

onebots 提供了 imhelper 客户端SDK，可以方便地连接钉钉适配器：

```typescript
import { createImHelper } from 'imhelper';
import { createOnebot12Adapter } from '@imhelper/onebot-v12';

// 创建适配器
const adapter = createOnebot12Adapter({
  baseUrl: 'http://localhost:6727',
  selfId: 'your_bot_id',
  accessToken: 'your_token',
  receiveMode: 'ws',
  path: '/dingtalk/your_bot_id/onebot/v12',
  wsUrl: 'ws://localhost:6727/dingtalk/your_bot_id/onebot/v12',
  platform: 'dingtalk',
});

// 创建 ImHelper 实例
const helper = createImHelper(adapter);

// 监听消息事件
helper.on('message.private', (message) => {
  console.log('收到私聊消息:', message.content);
  message.reply([{ type: 'text', data: { text: '收到！' } }]);
});

helper.on('message.group', (message) => {
  console.log('收到群聊消息:', message.content);
  message.reply([{ type: 'text', data: { text: '收到！' } }]);
});

// 连接
await adapter.connect();
```

详细说明请查看：[客户端SDK使用指南](/guide/client-sdk)

## 相关链接

- [钉钉开放平台](https://open.dingtalk.com/)
- [钉钉机器人开发文档](https://open.dingtalk.com/document/robots/robot-overview)
- [钉钉适配器 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-dingtalk)
