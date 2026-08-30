# 飞书适配器

飞书适配器已完全实现，支持通过飞书开放平台 Bot API 接入 onebots 服务。同时支持**飞书（国内版）**和 **Lark（国际版）**。

## 状态

✅ **已实现并可用**

## 功能特性

- ✅ **消息与互动**：单聊、群聊、回复、消息/话题转发、富文本、卡片、媒体、名片、表情回复、跟随气泡、加急与 Pin
- ✅ **消息管理**：获取、撤回、卡片更新、已读用户与批量消息状态管理
- ✅ **群组管理**：群信息、成员、管理员、分享链接和群公告
- ✅ **用户目录**：机器人身份、应用可见通讯录用户与真实群成员
- ✅ **事件接入**：官方长连接、Webhook 和 manual 宿主接入；未知事件通过 `raw_event` 无损交付
- ✅ **可靠性**：tenant token 合并与失效重试、事件去重、受约束游标分页和结构化平台错误
- ✅ **多端点支持**
  - 飞书（国内版）
  - Lark（国际版）
  - 自定义端点（私有化部署）

## 安装

```bash
npm install @onebots/adapter-feishu
# 或
pnpm add @onebots/adapter-feishu
```

## 配置

在 `config.yaml` 中配置飞书账号：

```yaml
# 飞书机器人账号配置（国内版，默认）
feishu.feishu_bot:
  app_id: 'your_app_id'  # 应用 App ID，必填
  app_secret: 'your_app_secret'  # 应用 App Secret，必填
  receive_mode: long_connection  # long_connection | webhook | manual
  encrypt_key: 'your_encrypt_key'  # 可选，事件加密密钥
  verification_token: 'your_verification_token'  # 可选，事件验证 Token
  
  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'your_v11_token'

# Lark 机器人账号配置（国际版）
feishu.lark_bot:
  app_id: 'your_app_id'
  app_secret: 'your_app_secret'
  endpoint: 'https://open.larksuite.com/open-apis'  # Lark 端点
  
  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'your_v11_token'
```

### 配置项说明

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `app_id` | string | 是 | 飞书/Lark 应用 App ID |
| `app_secret` | string | 是 | 飞书/Lark 应用 App Secret |
| `receive_mode` | string | 否 | 事件接收方式，默认 `long_connection` |
| `encrypt_key` | string | 否 | 事件加密密钥 |
| `verification_token` | string | 否 | 事件验证 Token |
| `endpoint` | string | 否 | API 端点，默认为飞书国内版 |

### 端点配置

| 端点 | URL | 说明 |
|------|-----|------|
| 飞书（默认） | `https://open.feishu.cn/open-apis` | 国内版 |
| Lark | `https://open.larksuite.com/open-apis` | 国际版 |

### TypeScript 配置

使用 TypeScript 时，可以导入端点常量：

```typescript
import { FeishuEndpoint } from '@onebots/adapter-feishu';

// 飞书（国内版）- endpoint 可省略
{
  account_id: 'feishu_bot',
  app_id: 'cli_xxx',
  app_secret: 'xxx',
}

// Lark（国际版）
{
  account_id: 'lark_bot',
  app_id: 'cli_xxx',
  app_secret: 'xxx',
  endpoint: FeishuEndpoint.LARK,
}

// 私有化部署
{
  account_id: 'private_bot',
  app_id: 'cli_xxx',
  app_secret: 'xxx',
  endpoint: 'https://your-private-feishu.com/open-apis',
}
```

## 获取应用凭证

### 飞书（国内版）

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 获取 `App ID` 和 `App Secret`
4. 选择官方长连接，或配置事件订阅 URL（Webhook）：`http://your-server:port/feishu/{account_id}/webhook`
5. 配置应用权限（消息收发、通讯录等）

### Lark（国际版）

1. 访问 [Lark Developer](https://open.larksuite.com/)
2. 创建应用并获取凭证
3. 配置方式与飞书相同，只需在配置中设置 `endpoint` 为 Lark 端点

## 使用示例

### 启动服务

```bash
# 注册飞书适配器和 OneBot V11 协议
onebots -r feishu -p onebot.v11
```

### 客户端 SDK 使用

onebots 提供了 imhelper 客户端SDK，可以方便地连接飞书适配器：

```typescript
import { createOnebot12Client } from '@imhelper/onebot-v12';

const client = createOnebot12Client({
  baseUrl: 'http://localhost:6727/feishu/your_bot_id/onebot/v12',
  apiBaseUrl: 'http://localhost:6727/feishu/your_bot_id/onebot/v12',
  wsUrl: 'ws://localhost:6727/feishu/your_bot_id/onebot/v12',
  selfId: 'your_bot_id',
  accessToken: 'your_token',
  receiveMode: 'ws',
});

// 监听消息事件
client.on('message.private', async message => {
  console.log('收到私聊消息:', message.content);
  await message.reply('收到！');
});

client.on('message.group', async message => {
  console.log('收到群聊消息:', message.content);
  await message.reply('收到！');
});

await client.start();
```

详细说明请查看：[客户端SDK使用指南](/guide/client-sdk)

## 相关链接

- [飞书开放平台](https://open.feishu.cn/)
- [飞书 Bot 开发文档](https://open.feishu.cn/document/ukTMukTMukTM/uczM3QjL3MzN04yNzcDN)
- [飞书适配器 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-feishu)
