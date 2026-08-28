# @onebots/protocol-onebot-v11

onebots OneBot V11 协议实现 - 支持 OneBot 11 标准的协议插件

## 简介

`@onebots/protocol-onebot-v11` 是 onebots 框架的官方 OneBot V11 协议实现，完全兼容 [OneBot 11 标准](https://github.com/botuniverse/onebot-v11)，提供 HTTP、WebSocket 等多种通信方式。

## 特性

- ✅ **完整支持** - 实现 OneBot 11 全部标准 API
- 🔌 **多通信方式** - HTTP、WebSocket、HTTP Reverse、WebSocket Reverse
- 🔐 **安全认证** - 支持 Access Token 和签名验证
- 📨 **消息格式** - 支持 CQ 码和数组格式
- 🎯 **事件过滤** - 灵活的事件过滤机制
- 🔄 **自动转换** - 平台消息与 OneBot 格式自动转换

## 安装

```bash
npm install @onebots/protocol-onebot-v11
# 或
pnpm add @onebots/protocol-onebot-v11
```

## 使用方法

> **重要：** 协议必须先注册才能使用。即使在配置文件中配置了 `onebot.v11` 协议，如果没有注册该协议，配置也不会生效。

### 1. 命令行注册（推荐）

使用 `onebots` 命令行工具时，通过 `-p` 参数注册协议：

```bash
# 注册 OneBot V11 协议
onebots -p onebot-v11

# 同时注册多个协议
onebots -p onebot-v11 -p onebot-v12 -p satori-v1

# 注册协议并指定适配器
onebots -r wechat -p onebot-v11 -c config.yaml
```

协议会自动从以下位置加载：

- `@onebots/protocol-onebot-v11` (官方包)
- `onebots-protocol-onebot-v11` (社区包)
- `onebot-v11` (直接包名)

### 2. 配置文件方式

```yaml
accounts:
  - platform: wechat
    account_id: my_account
    protocol: onebot.v11

    # OneBot V11 配置
    use_http: true # 启用 HTTP
    use_ws: true # 启用 WebSocket
    access_token: your_token # 访问令牌
    secret: your_secret # 签名密钥
    heartbeat_interval: 15000 # 心跳间隔(ms)

    # HTTP Reverse
    http_reverse:
      - http://localhost:5700/onebot/v11

    # WebSocket Reverse
    ws_reverse:
      - ws://localhost:6700/onebot/v11
```

### 3. 代码方式

```typescript
import { App } from "onebots";
import { OneBotV11Protocol } from "@onebots/protocol-onebot-v11";

// 注册协议
await App.registerProtocol("onebot", OneBotV11Protocol, "v11");

// 创建应用
const app = new App();
await app.start();
```

## 配置参数

### 通信方式

| 参数           | 类型     | 默认值 | 说明                   |
| -------------- | -------- | ------ | ---------------------- |
| `use_http`     | boolean  | true   | 启用 HTTP API          |
| `use_ws`       | boolean  | false  | 启用 WebSocket         |
| `http_reverse` | string[] | []     | HTTP 反向推送地址      |
| `ws_reverse`   | string[] | []     | WebSocket 反向连接地址 |

### 安全配置

| 参数           | 类型    | 默认值 | 说明      |
| -------------- | ------- | ------ | --------- |
| `access_token` | string  | -      | 访问令牌  |
| `secret`       | string  | -      | 签名密钥  |
| `enable_cors`  | boolean | false  | 启用 CORS |

### 消息配置

| 参数                  | 类型                | 默认值  | 说明         |
| --------------------- | ------------------- | ------- | ------------ |
| `post_message_format` | "string" \| "array" | "array" | 消息格式     |
| `heartbeat_interval`  | number              | -       | 心跳间隔(ms) |
| `post_timeout`        | number              | 5000    | 推送超时(ms) |

## 通信方式

### HTTP API

访问地址：

```
http://host:port/{platform}/{account_id}/onebot/v11/{action}
```

示例：

```bash
curl -X POST http://localhost:6727/wechat/my_account/onebot/v11/send_private_msg \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{"user_id": 123456, "message": "Hello"}'
```

### WebSocket

连接地址：

```
ws://host:port/{platform}/{account_id}/onebot/v11
```

### HTTP Reverse

onebots 主动推送事件到配置的 HTTP 地址。

### WebSocket Reverse

onebots 主动连接到配置的 WebSocket 地址。

## API 列表

### 消息 API

- `send_private_msg` - 发送私聊消息
- `send_group_msg` - 发送群消息
- `send_msg` - 发送消息
- `delete_msg` - 撤回消息
- `get_msg` - 获取消息
- `get_forward_msg` - 获取合并转发消息
- `send_like` - 发送好友赞
- `set_group_kick` - 群组踢人
- `invite_friend_to_group` - 邀请机器人好友加入群（OneBots 扩展）
- `set_group_ban` - 群组单人禁言
- `set_group_anonymous_ban` - 群组匿名用户禁言
- `set_group_whole_ban` - 群组全员禁言
- `set_group_admin` - 群组设置管理员
- `set_group_anonymous` - 群组匿名
- `set_group_card` - 设置群名片
- `set_group_name` - 设置群名
- `set_group_leave` - 退出群组
- `set_group_special_title` - 设置群组专属头衔
- `set_friend_add_request` - 处理加好友请求
- `set_group_add_request` - 处理加群请求/邀请

### 获取信息 API

- `get_login_info` - 获取登录号信息
- `get_stranger_info` - 获取陌生人信息
- `get_friend_list` - 获取好友列表
- `get_group_info` - 获取群信息
- `get_group_list` - 获取群列表
- `get_group_member_info` - 获取群成员信息
- `get_group_member_list` - 获取群成员列表
- `get_group_honor_info` - 获取群荣誉信息
- `get_cookies` - 获取 Cookies
- `get_csrf_token` - 获取 CSRF Token
- `get_credentials` - 获取 QQ 相关接口凭证
- `get_record` - 获取语音
- `get_image` - 获取图片
- `can_send_image` - 检查是否可以发送图片
- `can_send_record` - 检查是否可以发送语音
- `get_status` - 获取运行状态
- `get_version_info` - 获取版本信息
- `set_restart` - 重启 OneBot 实现
- `clean_cache` - 清理缓存

## CQ 码支持

完整支持 CQ 码格式：

```javascript
// 文本
[CQ:text,text=Hello]

// 表情
[CQ:face,id=123]

// 图片
[CQ:image,file=http://example.com/image.jpg]

// 语音
[CQ:record,file=http://example.com/audio.mp3]

// @某人
[CQ:at,qq=123456]

// 回复
[CQ:reply,id=123456]

// 更多 CQ 码...
```

## 事件类型

### 消息事件

- `message.private` - 私聊消息
- `message.group` - 群消息

### 通知事件

- `notice.group_upload` - 群文件上传
- `notice.group_admin` - 群管理员变动
- `notice.group_decrease` - 群成员减少
- `notice.group_increase` - 群成员增加
- `notice.group_ban` - 群禁言
- `notice.friend_add` - 好友添加
- `notice.group_recall` - 群消息撤回
- `notice.friend_recall` - 好友消息撤回

### 请求事件

- `request.friend` - 加好友请求
- `request.group` - 加群请求/邀请

### 元事件

- `meta_event.lifecycle` - 生命周期
- `meta_event.heartbeat` - 心跳

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build
```

## 相关链接

- [OneBot 11 标准](https://github.com/botuniverse/onebot-v11)
- [OneBot 文档](https://github.com/botuniverse/onebot)
- [onebots 文档](../../docs)

## 许可证

MIT License - 查看 [LICENSE](../../LICENSE) 文件了解详情

## 作者

凉菜
