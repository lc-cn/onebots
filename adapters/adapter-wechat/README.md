# @onebots/adapter-wechat

onebots 微信公众号适配器 - 支持微信公众号平台的机器人适配器

## 简介

`@onebots/adapter-wechat` 是 onebots 框架的官方微信公众号适配器，用于连接微信公众号平台，将微信的消息和事件转换为 onebots 的通用格式。

## 特性

- 🔐 **安全验证** - 支持微信服务器验证和消息加解密
- 📨 **消息处理** - 完整的消息接收和发送支持
- 🎯 **事件处理** - 支持关注、取消关注等事件
- 🔄 **自动转换** - 自动将微信消息转换为通用格式
- 📡 **Webhook** - 支持微信 Webhook 回调

## 安装

```bash
npm install @onebots/adapter-wechat
# 或
pnpm add @onebots/adapter-wechat
```

## 使用方法

> **重要：** 适配器必须先注册才能使用。即使在配置文件中配置了微信账号，如果没有注册该适配器，配置也不会生效。

### 1. 命令行注册（推荐）

使用 `onebots` 命令行工具时，通过 `-r` 参数注册适配器：

```bash
# 注册微信适配器
onebots -r wechat

# 同时注册多个适配器
onebots -r wechat -r qq -r kook

# 注册适配器并指定配置文件
onebots -r wechat -c config.yaml
```

适配器会自动从以下位置加载：
- `@onebots/adapter-wechat` (官方包)
- `onebots-adapter-wechat` (社区包)
- `wechat` (直接包名)

### 2. 配置文件方式

在 `config.yaml` 中配置：

```yaml
accounts:
  - platform: wechat
    account_id: my_wechat_mp
    protocol: onebot.v11
    
    # 微信公众号配置
    app_id: your_app_id
    app_secret: your_app_secret
    token: your_token
    encoding_aes_key: your_aes_key  # 可选，用于消息加解密
```

### 3. 代码方式

```typescript
import { App } from 'onebots';
import { WeChatAdapter } from '@onebots/adapter-wechat';

// 注册适配器
await App.registerAdapter('wechat', WeChatAdapter);

// 创建应用
const app = new App({
  accounts: [{
    platform: 'wechat',
    account_id: 'my_wechat',
    protocol: 'onebot.v11',
    app_id: 'your_app_id',
    app_secret: 'your_app_secret',
    token: 'your_token',
  }]
});

await app.start();
```

## 配置参数

### 必需参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `app_id` | string | 微信公众号 AppID |
| `app_secret` | string | 微信公众号 AppSecret |
| `token` | string | 微信服务器配置的 Token |

### 可选参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `encoding_aes_key` | string | - | 消息加解密密钥 |
| `webhook_path` | string | `/wechat/{account_id}` | Webhook 路径 |

## Webhook 配置

在微信公众平台后台配置服务器地址：

```
http://your-domain:6727/wechat/{account_id}
```

例如：
```
http://example.com:6727/wechat/my_wechat_mp
```

## 被动回复：sendMessage 如何通过 Webhook 回到公众号会话

微信 **被动回复** 的规则是：在用户发消息的 **同一次 HTTP POST** 响应体里返回 XML（不能靠另起一个请求把「回复」推给微信）。时限约 **5 秒**，实现上本适配器在 Webhook 里 **最多等待约 4 秒** 收集回复再结束响应。

### 链路（本仓库已实现）

1. **微信** `POST .../webhook` 推送用户消息 XML → `WechatBot.handleWebhook` 解析后写入 `messageContext`（按用户 openid 记录上行里的 `FromUserName` / `ToUserName`）。
2. 同步 `emit('message', ...)` → 适配器转成 **CommonEvent** → 各协议/Milky 等可异步处理。
3. 协议层调用 **`Adapter.sendMessage`**（私聊 `scene_id` 为用户 **openid**）→ `WechatBot.sendText` / 其他发送方法。
4. 若在 **约 5 秒内** 且未设 `forceActive`：不向 `custom/send` 发请求，而是把拼好的 **被动回复 XML** 放入 `passiveReplyQueue`（按 openid）。
5. `handleWebhook` 里 **`waitForPassiveReply(openid)`** 轮询队列，取到 XML 后作为 **`ctx.body`** 返回（`Content-Type: application/xml`），微信再把内容下发给用户。
6. 若已超过窗口或非被动路径：走 **客服消息** `POST /cgi-bin/message/custom/send`（需 **服务号** 等权限，且有 48 小时等限制）。

### 接入侧注意

- **必须在用户发消息后的几秒钟内** 完成 `sendMessage`（从收到 Webhook 开始算），被动回复才能进队并被写进本次响应。
- 若业务很慢（例如先 HTTP 出去再处理），被动回复往往来不及，应依赖 **客服消息** 或 **异步客服**，或缩短链路。
- 需要强制走接口而不是被动回复时，可在参数里传 `forceActive: true`（见 `sendMessage` 实现中的扩展字段）。
- **安全模式/加密** 下，被动回复 XML 若也需加密，需按微信文档对返回体再包一层（当前实现以明文或文档约定为准时，请对照后台「消息加解密」配置）。

## 支持的消息类型

### 接收消息

- ✅ 文本消息
- ✅ 图片消息
- ✅ 语音消息
- ✅ 视频消息
- ✅ 地理位置消息
- ✅ 链接消息

### 发送消息

- ✅ 文本消息
- ✅ 图片消息
- ✅ 语音消息
- ✅ 视频消息
- ✅ 音乐消息
- ✅ 图文消息

### 支持的事件

- ✅ 关注/取消关注事件
- ✅ 扫描带参数二维码事件
- ✅ 上报地理位置事件
- ✅ 自定义菜单事件
- ✅ 点击菜单拉取消息事件
- ✅ 点击菜单跳转链接事件

## API 方法

适配器提供了微信公众号的常用 API：

```typescript
// 发送消息
await adapter.sendMessage(userId, message);

// 获取用户信息
const userInfo = await adapter.getUserInfo(userId);

// 获取 Access Token
const token = await adapter.getAccessToken();

// 创建自定义菜单
await adapter.createMenu(menu);

// 获取自定义菜单
const menu = await adapter.getMenu();

// 删除自定义菜单
await adapter.deleteMenu();
```

## 消息格式转换

适配器会自动将微信消息格式转换为 onebots 通用格式：

### 接收消息示例

微信格式：
```xml
<xml>
  <ToUserName><![CDATA[公众号]]></ToUserName>
  <FromUserName><![CDATA[用户OpenID]]></FromUserName>
  <CreateTime>1234567890</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[你好]]></Content>
  <MsgId>1234567890123456</MsgId>
</xml>
```

onebots 通用格式：
```json
{
  "type": "message",
  "message_type": "private",
  "user_id": "用户OpenID",
  "message": "你好",
  "message_id": "1234567890123456",
  "timestamp": 1234567890
}
```

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build
```

## 相关链接

- [微信公众平台开发文档](https://developers.weixin.qq.com/doc/offiaccount/Getting_Started/Overview.html)
- [onebots 文档](../../docs)

## 许可证

MIT License - 查看 [LICENSE](../../LICENSE) 文件了解详情

## 作者

凉菜
