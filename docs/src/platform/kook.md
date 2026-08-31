# Kook 适配器

Kook（原开黑啦）适配器已完全实现，支持通过 Kook Bot API 接入 onebots 服务。

## 状态

✅ **已实现并可用**

## 功能特性

- ✅ **WebSocket 和 Webhook 两种连接模式**
- ✅ **消息收发**
  - 频道消息收发
  - 私聊消息收发
  - 支持文本、图片、KMarkdown、卡片等多种消息格式
- ✅ **服务器（公会）管理**
  - 获取服务器列表和信息
  - 退出服务器
- ✅ **频道管理**
  - 获取频道列表和信息
  - 创建、更新、删除频道
  - 获取频道成员列表
- ✅ **成员管理**
  - 获取成员信息
  - 踢出成员
  - 设置成员昵称
- ✅ **角色管理**
  - 获取角色列表
  - 创建、更新、删除角色
- ✅ **表情回应**
  - 添加/删除表情回应
- ✅ **文件上传**
- ✅ **语音频道事件**
  - 加入/离开语音频道

## 安装

```bash
npm install @onebots/adapter-kook
# 或
pnpm add @onebots/adapter-kook
```

## 配置

在 `config.yaml` 中配置 Kook 账号：

```yaml
# Kook 机器人账号配置
kook.zhin:
  # Kook 平台配置
  token: 'your_kook_token'
  mode: 'websocket'  # 或 'webhook'，默认为 'websocket'
  verifyToken: 'your_verify_token'  # Webhook 模式需要
  encryptKey: 'your_encrypt_key'  # 可选，消息加密密钥
  
  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'your_v11_token'
  
  # OneBot V12 协议配置
  onebot.v12:
    access_token: 'your_v12_token'
  
  # Satori V1 协议配置
  satori.v1:
    token: 'your_satori_token'
    platform: 'kook'
  
  # Milky V1 协议配置
  milky.v1:
    access_token: 'your_milky_token'
```

### 配置项说明

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `token` | string | 是 | Kook 机器人 Token |
| `mode` | string | 否 | 连接模式：`websocket`（默认）或 `webhook` |
| `verifyToken` | string | 否 | Webhook 验证 Token（Webhook 模式需要） |
| `encryptKey` | string | 否 | 消息加密密钥（可选） |

## 获取 Token

1. 访问 [KOOK 开发者平台](https://developer.kookapp.cn/)
2. 创建应用并添加机器人
3. 在机器人设置中获取 Token

## 启动服务

```bash
# 启动 onebots 服务，加载 Kook 适配器
onebots -r kook -p onebot-v11 -p onebot-v12 -p satori-v1 -c config.yaml
```

## 使用客户端SDK连接

```typescript
import { createImHelper } from 'imhelper';
import { createOnebot11Adapter } from '@imhelper/onebot-v11';

const adapter = createOnebot11Adapter({
  baseUrl: 'http://localhost:6727',
  selfId: 'zhin',
  accessToken: 'your_v11_token',
  receiveMode: 'ws',
  path: '/kook/zhin/onebot/v11',
  wsUrl: 'ws://localhost:6727/kook/zhin/onebot/v11',
  platform: 'kook',
});

const helper = createImHelper(adapter);
await adapter.connect();
```

详细说明请查看：[客户端SDK使用指南](/guide/client-sdk)

## 相关文档

- [Kook 适配器 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-kook)
- [配置说明](/config/adapter/kook)
- [客户端SDK使用指南](/guide/client-sdk)

## 开发计划

Kook 适配器正在规划中，将基于 Kook 官方 Bot API 开发。

## 相关链接

- [Kook 开发者平台](https://developer.kookapp.cn/)
- [Kook Bot 文档](https://developer.kookapp.cn/doc/intro)
