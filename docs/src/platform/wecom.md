# 企业微信适配器

企业微信适配器已完全实现，支持通过企业微信 **自建应用消息** 接入 onebots 服务。

> **微信客服**（`kf/sync_msg`、`kf/send_msg`、视频号/搜一搜等进线）请使用独立适配器 [**微信客服 wecom-kf**](./wecom-kf.md)，勿与本页「应用消息」混淆。

## 状态

✅ **已实现并可用**

## 功能特性

- ✅ **应用消息推送**
  - 文本消息
  - 图片消息
  - 视频消息
  - 文件消息
  - 文本卡片
  - Markdown 消息
  - 图文消息
- ✅ **通讯录管理**
  - 获取用户信息
  - 获取部门列表
  - 获取部门成员列表
- ✅ **事件订阅**
  - 通讯录变更事件（用户创建/更新/删除）
  - 应用消息回调

## 安装

```bash
npm install @onebots/adapter-wecom
# 或
pnpm add @onebots/adapter-wecom
```

## 配置

在 `config.yaml` 中配置企业微信账号：

```yaml
# 企业微信应用配置
wecom.your_bot_id:
  # 企业微信平台配置
  corp_id: 'your_corp_id'  # 企业 ID，必填
  corp_secret: 'your_corp_secret'  # 应用 Secret，必填
  agent_id: 'your_agent_id'  # 应用 AgentId，必填
  token: 'your_token'  # 可选，回调验证 Token
  encoding_aes_key: 'your_encoding_aes_key'  # 可选，消息加解密密钥
  
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
| `corp_id` | string | 是 | 企业 ID |
| `corp_secret` | string | 是 | 应用 Secret |
| `agent_id` | string | 是 | 应用 AgentId |
| `token` | string | 否 | 回调验证 Token |
| `encoding_aes_key` | string | 否 | 消息加解密密钥 |

## 获取应用凭证

1. 访问 [企业微信管理后台](https://work.weixin.qq.com/)
2. 应用管理 → 创建应用
3. 获取 `企业ID`（CorpID）
4. 获取 `应用Secret`（CorpSecret）
5. 获取 `应用ID`（AgentID）
6. 配置回调 URL：`http://your-server:port/wecom/{account_id}/webhook`
7. 获取 `Token` 和 `EncodingAESKey`（如果启用加密）

## 使用示例

### 启动服务

```bash
# 注册企业微信适配器和 OneBot V11 协议
onebots -r wecom -p onebot.v11
```

### 客户端 SDK 使用

onebots 提供了 imhelper 客户端SDK，可以方便地连接企业微信适配器：

```typescript
import { createImHelper } from 'imhelper';
import { createOnebot12Adapter } from '@imhelper/onebot-v12';

// 创建适配器
const adapter = createOnebot12Adapter({
  baseUrl: 'http://localhost:6727',
  selfId: 'your_bot_id',
  accessToken: 'your_token',
  receiveMode: 'ws',
  path: '/wecom/your_bot_id/onebot/v12',
  wsUrl: 'ws://localhost:6727/wecom/your_bot_id/onebot/v12',
  platform: 'wecom',
});

// 创建 ImHelper 实例
const helper = createImHelper(adapter);

// 监听消息事件
helper.on('message.private', (message) => {
  console.log('收到私聊消息:', message.content);
  message.reply([{ type: 'text', data: { text: '收到！' } }]);
});

// 连接
await adapter.connect();
```

详细说明请查看：[客户端SDK使用指南](/guide/client-sdk)

## 相关链接

- [企业微信开放平台](https://developer.work.weixin.qq.com/)
- [企业微信应用开发文档](https://developer.work.weixin.qq.com/document/path/90488)
- [企业微信适配器 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wecom)

