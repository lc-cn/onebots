# WeChat Official Account Adapter (微信公众号适配器)

基于微信公众号开发者API的 OneBots 适配器，支持接收和发送微信公众号消息。

## 功能特性

- 🔌 **完整协议支持**: 支持微信公众号开发者模式
- 📨 **消息处理**: 支持文本、图片、语音、视频、地理位置等消息类型
- 🎯 **事件处理**: 支持关注、取关、菜单点击等事件
- 🔐 **安全验证**: 完整的签名验证和加密支持
- 🔄 **Token管理**: 自动获取和刷新access_token
- 💬 **双向通信**: 支持被动回复和主动推送
- 🎛️ **多媒体支持**: 支持图片、语音、视频等多媒体消息

## 前置准备

### 1. 申请微信公众号

1. 前往 [微信公众平台](https://mp.weixin.qq.com/) 注册账号
2. 选择订阅号或服务号（服务号功能更丰富）
3. 完成认证（可选，但认证后功能更多）

### 2. 获取开发者信息

1. 登录微信公众平台
2. 进入「开发」->「基本配置」
3. 获取以下信息：
   - **AppID** (应用ID)
   - **AppSecret** (应用密钥)
   - 设置 **Token** (自定义，用于验证)
   - 设置 **EncodingAESKey** (可选，用于加密)

### 3. 配置服务器

1. 在「基本配置」中设置服务器地址：
   ```
   URL: http://your-domain.com/wechat-mp/{account_id}/webhook
   Token: 你设置的token
   ```
2. 选择消息加解密方式（明文模式或安全模式）

## 安装

```bash
npm install onebots
```

## 配置

在 `config.yaml` 中添加以下配置：

```yaml
# 微信公众号机器人
wechat-mp.my_official_account:
  onebot.v11:
    use_http: true
    use_ws: true

  onebot.v12:
    use_http: true
    use_ws: true

  # 微信公众号平台配置
  appId: "wx1234567890abcdef" # 公众号 AppID (从微信公众平台获取)
  appSecret: "your-app-secret-key" # 公众号 AppSecret (从微信公众平台获取)
  token: "your-token" # 服务器配置 Token (自定义，用于验证服务器)
  encodingAESKey: "" # 消息加解密密钥 (可选，用于加密模式)
  encrypt: false # 是否启用加密模式
```

## 使用

### 启动服务

```bash
npx onebots -r wechat-mp -c config.yaml
```

### 访问端点

- HTTP: `http://localhost:6727/wechat-mp/{account_id}/onebot/v11`
- WebSocket: `ws://localhost:6727/wechat-mp/{account_id}/onebot/v11`

## 支持的消息类型

### 接收消息

| 微信消息类型 | MessageSegment 类型 | 说明         |
| ------------ | ------------------- | ------------ |
| text         | `text`              | 文本消息     |
| image        | `image`             | 图片消息     |
| voice        | `voice`             | 语音消息     |
| video        | `video`             | 视频消息     |
| shortvideo   | `video`             | 小视频消息   |
| location     | `location`          | 地理位置消息 |
| link         | `link`              | 链接消息     |
| event        | `event`             | 事件消息     |

### 发送消息

| MessageSegment 类型 | 微信API  | 说明                    |
| ------------------- | -------- | ----------------------- |
| `text`              | 客服消息 | 文本消息                |
| `image`             | 客服消息 | 图片消息（需要mediaId） |
| `voice`             | 客服消息 | 语音消息（需要mediaId） |
| `video`             | 客服消息 | 视频消息（需要mediaId） |

### 事件类型

| 事件类型    | 说明         |
| ----------- | ------------ |
| subscribe   | 关注事件     |
| unsubscribe | 取关事件     |
| CLICK       | 菜单点击事件 |
| VIEW        | 菜单链接事件 |
| LOCATION    | 地理位置事件 |

## API 限制

1. **消息发送**: 每天主动推送消息有限制
2. **API调用**: 大部分API每分钟调用次数有限制
3. **媒体上传**: 临时素材3天后失效
4. **用户信息**: 只能获取关注用户的信息

## 注意事项

1. 微信公众号只支持私聊消息，不支持群组和频道
2. 发送消息需要用户先关注公众号
3. access_token 会自动刷新，无需手动管理
4. 建议使用 HTTPS 部署生产环境

## 常见错误

| 错误码 | 说明                 | 解决方案          |
| ------ | -------------------- | ----------------- |
| 40001  | AppSecret错误        | 检查AppSecret配置 |
| 40002  | 不合法的凭证类型     | 检查access_token  |
| 40003  | 不合法的OpenID       | 检查用户OpenID    |
| 40004  | 不合法的媒体文件类型 | 检查上传文件格式  |
| 40013  | 不合法的AppID        | 检查AppID配置     |
| 42001  | access_token超时     | 会自动刷新token   |

## 开发

本适配器遵循 OneBots 的适配器接口规范，实现了所有必需的方法。

### 项目结构

```
src/adapters/wechat-mp/
├── bot.ts       # WeChat MP Bot 客户端
├── index.ts     # 适配器主文件
└── utils.ts     # 工具函数
```

## 许可证

MIT
