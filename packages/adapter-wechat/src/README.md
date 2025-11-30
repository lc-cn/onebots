# 微信公众号适配器

基于 OneBots 统一 API 的微信公众号适配器，支持消息收发、粉丝管理、标签（分组）管理。

## 功能特性

### 账号类型说明

微信公众号分为两种类型，支持的功能不同：

- **订阅号（Subscription）**：默认类型
  - ✅ 被动回复消息（5秒窗口）
  - ✅ Webhook 接收消息和事件
  - ❌ 不支持主动调用 API（客服消息、用户管理、标签管理等）
  - ❌ 不需要 access_token

- **服务号（Service）**：
  - ✅ 被动回复消息
  - ✅ 主动发送客服消息
  - ✅ 用户管理 API
  - ✅ 标签管理 API
  - ✅ 需要 access_token

### ✅ 已实现功能

#### 消息管理
- ✅ **发送消息** (`sendMessage`)
  - 被动回复（订阅号/服务号）：文本、图片、语音、视频、音乐、图文
  - 客服消息（仅服务号）：文本、图片、语音、视频、音乐、图文
- ❌ 删除消息（微信公众号不支持）
- ❌ 获取消息（微信公众号不支持）

#### 用户管理（仅服务号）
- ✅ **获取机器人信息** (`getLoginInfo`)
- ✅ **获取用户信息** (`getUserInfo`)
- ✅ **获取好友列表** (`getFriendList`) - 获取所有关注粉丝
- ✅ **获取好友信息** (`getFriendInfo`)

#### 标签管理（仅服务号）
- ✅ **获取标签列表** (`getGroupList`)
- ✅ **获取标签信息** (`getGroupInfo`)
- ✅ **设置标签名称** (`setGroupName`)
- ✅ **获取标签成员列表** (`getGroupMemberList`)
- ✅ **获取标签成员信息** (`getGroupMemberInfo`)

#### 微信公众号特有功能（仅服务号）
- ✅ 创建标签
- ✅ 删除标签
- ✅ 为用户打标签
- ✅ 为用户取消标签
- ✅ 获取用户的标签列表
- ✅ 设置用户备注
- ✅ 拉黑用户
- ✅ 取消拉黑
- ✅ 获取黑名单

## 配置说明

### 配置文件示例

#### 订阅号配置（默认）

```yaml
accounts:
  - platform: wechat
    account_id: "my_wechat_mp"
    appId: "wx7d902101aaf80928"
    appSecret: "529d7633f02993310e23313ccb3ee5f5"
    token: "zhinBot"
    encodingAESKey: "iLSwgcYa5KC2xulcMBHCeptI7VZNECZLbhB0b4vLvkU"  # 可选
    accountType: "subscription"  # 可省略，默认就是 subscription
    nickname: "ZhinBot"
```

#### 服务号配置

```yaml
accounts:
  - platform: wechat
    account_id: "my_wechat_service"
    appId: "wx7d902101aaf80928"
    appSecret: "529d7633f02993310e23313ccb3ee5f5"
    token: "zhinBot"
    encodingAESKey: "iLSwgcYa5KC2xulcMBHCeptI7VZNECZLbhB0b4vLvkU"
    accountType: "service"  # 服务号必须指定
    nickname: "ZhinBot"
    
    # 协议配置
    onebot.v11:
      enable: true
      http:
        enable: true
        port: 6727
    
    satori.v1:
      enable: true
      http:
        enable: true
        port: 5140
```

### 配置参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `platform` | string | ✅ | 固定为 `wechat` |
| `account_id` | string | ✅ | 账号唯一标识 |
| `appId` | string | ✅ | 微信公众号 AppID |
| `appSecret` | string | ✅ | 微信公众号 AppSecret |
| `token` | string | ✅ | 服务器配置 Token |
| `encodingAESKey` | string | ❌ | 消息加密密钥 |
| `accountType` | string | ❌ | 账号类型：`subscription`（订阅号，默认）或 `service`（服务号） |
| `nickname` | string | ❌ | 公众号显示名称 |

## 使用示例

### 1. 发送消息给粉丝

```typescript
// 通过 Adapter API
const result = await adapter.sendMessage('my_wechat_mp', {
    scene_type: 'private',
    scene_id: adapter.createId('openid_xxx'),
    message: [
        { type: 'text', data: { text: '你好！' } }
    ]
});

// 通过 Bot API
const bot = account.client;
await bot.sendText('openid_xxx', '你好！');
```

### 2. 获取粉丝列表

```typescript
// 通过 Adapter API
const friends = await adapter.getFriendList('my_wechat_mp');
console.log(`共有 ${friends.length} 个粉丝`);

// 通过 Bot API
const userList = await bot.getUserList();
console.log(`总粉丝数: ${userList.total}`);
```

### 3. 管理标签（分组）

```typescript
// 创建标签
const tag = await adapter.createTag('my_wechat_mp', 'VIP用户');
console.log(`创建标签: ${tag.name}, ID: ${tag.id}`);

// 获取所有标签
const groups = await adapter.getGroupList('my_wechat_mp');
groups.forEach(group => {
    console.log(`${group.group_name}: ${group.member_count} 人`);
});

// 为用户打标签
await adapter.tagUsers('my_wechat_mp', ['openid1', 'openid2'], tag.id);

// 获取标签下的粉丝
const members = await adapter.getGroupMemberList('my_wechat_mp', {
    group_id: adapter.createId(tag.id)
});
```

### 4. 黑名单管理

```typescript
// 拉黑用户
await adapter.blackUsers('my_wechat_mp', ['openid_xxx']);

// 获取黑名单
const blacklist = await adapter.getBlacklist('my_wechat_mp');
console.log(`黑名单用户数: ${blacklist.length}`);

// 取消拉黑
await adapter.unblackUsers('my_wechat_mp', ['openid_xxx']);
```

### 5. 设置用户备注

```typescript
await adapter.setUserRemark('my_wechat_mp', 'openid_xxx', '张三');
```

## 消息发送限制

微信公众号使用**客服消息API**发送消息：

- **限制**: 用户发送消息后 **48小时内** 可以发送 **最多5条** 客服消息
- **适用场景**: 
  - 回复用户消息
  - 客服对话
  - 自动回复

**注意**: 
- 超过48小时窗口期或超过5条限制后，无法发送客服消息
- 如需主动推送，请使用模板消息API（需单独实现）

```typescript
// 发送消息（客服消息API）
await adapter.sendMessage(uin, {
    scene_type: 'private',
    scene_id: adapter.createId(openid),
    message: '你好！'  // 48小时内最多5条
});
```

## 事件接收

微信公众号通过 **Webhook** 方式接收用户消息和事件。

### 配置步骤

1. **配置公众号后台**
   - 登录微信公众平台
   - 进入 `开发` -> `基本配置`
   - 设置服务器地址: `http://your-domain:port/wechat/webhook/your_account_id`
   - 设置 Token（与 config.yaml 中的 token 一致）
   - 点击启用

2. **实现 Webhook 路由**

参考 `webhook-example.ts` 文件，在你的应用中添加路由：

```typescript
import { registerWechatWebhook } from './adapters/wechat/webhook-example.js';

// 在应用启动时注册
const app = new App(config);
const wechatAdapter = app.adapters.get('wechat');
registerWechatWebhook(app, wechatAdapter);
```

3. **接收事件**

适配器会自动将微信消息转换为 CommonEvent 格式，并派发到协议层（OneBot/Satori/Milky）：

```typescript
// 协议层会收到标准化的事件
{
    id: { string: "...", number: ... },
    timestamp: 1234567890000,
    platform: 'wechat',
    bot_id: { string: "account_id", number: ... },
    type: 'message',
    message_type: 'private',
    sender: {
        id: { string: "openid", number: ... },
        name: "openid"
    },
    message_id: { string: "msg_id", number: ... },
    raw_message: '用户发送的消息',
    message: [
        { type: 'text', data: { text: '用户发送的消息' } }
    ]
}
```

### Webhook 路由示例

```typescript
// GET /wechat/webhook/:account_id - 验证服务器
router.get('/wechat/webhook/:account_id', async (ctx) => {
    const { signature, timestamp, nonce, echostr } = ctx.query;
    const account = adapter.getAccount(account_id);
    const bot = account.client;
    
    if (bot.verifySignature(signature, timestamp, nonce)) {
        ctx.body = echostr;  // 返回验证码
    } else {
        ctx.status = 403;
    }
});

// POST /wechat/webhook/:account_id - 接收消息
router.post('/wechat/webhook/:account_id', async (ctx) => {
    const { signature, timestamp, nonce } = ctx.query;
    const account = adapter.getAccount(account_id);
    const bot = account.client;
    
    // 验证签名
    if (!bot.verifySignature(signature, timestamp, nonce)) {
        ctx.status = 403;
        return;
    }
    
    // 解析 XML 消息
    const xmlBody = ctx.request.body;
    const message = parseWechatXML(xmlBody);
    
    // 触发事件处理
    bot.handleIncomingMessage(message);
    
    ctx.body = 'success';
});
```关系

### 消息 API

| OneBots 统一 API | 微信公众号 API | 说明 |
|-----------------|---------------|------|
| `sendMessage` | `POST /cgi-bin/message/custom/send` | 发送客服消息 |
| `deleteMessage` | ❌ 不支持 | 微信不允许删除已发送消息 |
| `getMessage` | ❌ 不支持 | 微信不提供历史消息查询 |

### 用户 API

| OneBots 统一 API | 微信公众号 API | 说明 |
|-----------------|---------------|------|
| `getLoginInfo` | - | 返回公众号自身信息 |
| `getUserInfo` | `GET /cgi-bin/user/info` | 获取用户基本信息 |
| `getFriendList` | `GET /cgi-bin/user/get` | 获取关注者列表 |
| `getFriendInfo` | `GET /cgi-bin/user/info` | 获取用户详细信息 |

### 标签（分组）API

| OneBots 统一 API | 微信公众号 API | 说明 |
|-----------------|---------------|------|
| `getGroupList` | `GET /cgi-bin/tags/get` | 获取标签列表 |
| `getGroupInfo` | `GET /cgi-bin/tags/get` | 获取标签信息 |
| `setGroupName` | `POST /cgi-bin/tags/update` | 修改标签名 |
| `getGroupMemberList` | `POST /cgi-bin/user/tag/get` | 获取标签下粉丝列表 |
| `getGroupMemberInfo` | `GET /cgi-bin/user/info` | 获取用户信息 |

## 架构说明

```
┌─────────────────┐
│  Protocol Layer │  ← OneBot V11/V12, Satori, Milky
├─────────────────┤
│  Adapter Layer  │  ← 微信公众号适配器（本层）
├─────────────────┤
│   Bot Client    │  ← 微信公众号 API 封装
├─────────────────┤
│  Wechat API     │  ← 微信官方 API
└─────────────────┘
```

### 文件结构

```
src/adapters/wechat/
├── index.ts        # 适配器主文件
├── bot.ts          # Bot 客户端实现
├── types.ts        # TypeScript 类型定义
└── README.md       # 本文档
```

## 注意事项

### 1. 微信公众号限制

- **消息限制**：只能给 48 小时内与公众号有互动的用户发消息
- **主动消息**：需使用客服消息接口，有次数限制
- **群发消息**：需使用模板消息或群发接口，有特殊限制
- **消息类型**：支持文本、图片、语音、视频、图文等

### 2. Access Token 管理

- Access Token 有效期为 7200 秒（2小时）
- 适配器会自动刷新 Token，提前 5 分钟更新
- Token 刷新失败会触发 `error` 事件

### 3. 标签 vs 分组

- 微信公众号使用**标签**（Tags）替代了旧的**分组**（Groups）
- 一个用户可以有多个标签
- 适配器将标签映射为 OneBots 的 `Group` 概念

### 4. OpenID vs UIN

- 微信使用 `openid` 标识用户
- 适配器会自动将 `openid` 转换为 OneBots 的 `Id` 类型
- 同一用户在不同公众号的 openid 不同

## 依赖安装

```bash
npm install axios form-data
# 或
pnpm add axios form-data
```

## 微信公众平台配置

1. 登录[微信公众平台](https://mp.weixin.qq.com)
2. 进入 **开发 > 基本配置**
3. 获取 **AppID** 和 **AppSecret**
4. 配置 **IP白名单**
5. 设置 **服务器配置**（如需接收消息）
   - URL: `http://your-domain/wechat/webhook`
   - Token: 自定义 Token
   - EncodingAESKey: 随机生成

## 许可证

与 OneBots 主项目保持一致。

## 相关链接

- [微信公众平台官方文档](https://developers.weixin.qq.com/doc/offiaccount/Getting_Started/Overview.html)
- [微信公众号 API 文档](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Service_Center_messages.html)
- [OneBots 项目](https://github.com/lc-cn/onebots)
