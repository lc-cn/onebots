# @onebots/adapter-wechat

OneBots 微信公众号适配器 - 支持微信公众号平台的机器人适配器

## 简介

`@onebots/adapter-wechat` 是 OneBots 框架的官方微信公众号适配器，用于连接微信公众号平台，将微信的消息和事件转换为 OneBots 的通用格式。

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

适配器会自动将微信消息格式转换为 OneBots 通用格式：

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

OneBots 通用格式：
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
- [OneBots 文档](../../docs)

## 许可证

MIT License - 查看 [LICENSE](../../LICENSE) 文件了解详情

## 作者

凉菜
