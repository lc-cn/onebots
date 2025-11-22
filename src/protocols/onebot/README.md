# OneBot Protocol Implementation

本目录包含 OneBot 协议的实现，支持 OneBot V11 和 V12 标准。

## 文件结构

```
onebot/
├── index.ts          # 协议注册和导出
├── v11.ts            # OneBot V11 协议实现
├── v12.ts            # OneBot V12 协议实现
├── types.ts          # OneBot V11 类型定义
├── cqcode.ts         # CQ 码工具类
├── utils.ts          # 通用工具函数
└── README.md         # 本文档
```

## OneBot V11

OneBot V11 是基于 OneBot 11 标准的实现，完全兼容 CQHTTP 接口。

### 标准参考

- 官方仓库：https://github.com/botuniverse/onebot-11
- 官方文档：https://11.onebot.dev

### 特性

#### 1. 通信方式

- **HTTP**: 提供 HTTP API 接口供客户端调用
- **WebSocket**: 提供 WebSocket 连接进行实时通信
- **HTTP POST (反向)**: 主动推送事件到指定的 HTTP 服务器
- **WebSocket (反向)**: 主动连接到指定的 WebSocket 服务器

#### 2. 消息格式

支持两种消息格式：

- **字符串格式 (CQ码)**: `[CQ:type,param1=value1,param2=value2]`
- **数组格式**: `[{type: "type", data: {param1: "value1"}}]`

#### 3. API 实现

##### 消息相关

- `send_private_msg` - 发送私聊消息
- `send_group_msg` - 发送群消息
- `send_msg` - 发送消息（自动识别类型）
- `delete_msg` - 撤回消息
- `get_msg` - 获取消息
- `get_forward_msg` - 获取合并转发消息
- `send_like` - 发送好友赞

##### 群组管理

- `set_group_kick` - 群组踢人
- `set_group_ban` - 群组单人禁言
- `set_group_anonymous_ban` - 群组匿名用户禁言
- `set_group_whole_ban` - 群组全员禁言
- `set_group_admin` - 群组设置管理员
- `set_group_anonymous` - 群组匿名
- `set_group_card` - 设置群名片（群备注）
- `set_group_name` - 设置群名
- `set_group_leave` - 退出群组
- `set_group_special_title` - 设置群组专属头衔

##### 请求处理

- `set_friend_add_request` - 处理加好友请求
- `set_group_add_request` - 处理加群请求/邀请

##### 信息获取

- `get_login_info` - 获取登录号信息
- `get_stranger_info` - 获取陌生人信息
- `get_friend_list` - 获取好友列表
- `get_group_info` - 获取群信息
- `get_group_list` - 获取群列表
- `get_group_member_info` - 获取群成员信息
- `get_group_member_list` - 获取群成员列表
- `get_group_honor_info` - 获取群荣誉信息

##### 其他

- `get_cookies` - 获取 Cookies
- `get_csrf_token` - 获取 CSRF Token
- `get_credentials` - 获取 QQ 相关接口凭证
- `get_record` - 获取语音
- `get_image` - 获取图片
- `can_send_image` - 检查是否可以发送图片
- `can_send_record` - 检查是否可以发送语音
- `get_status` - 获取状态
- `get_version_info` - 获取版本信息
- `set_restart` - 重启
- `clean_cache` - 清理缓存

#### 4. 事件类型

##### 消息事件 (message)

- 私聊消息 (`private`)
  - 好友消息 (`friend`)
  - 群临时会话 (`group`)
  - 其他 (`other`)
- 群消息 (`group`)
  - 正常消息 (`normal`)
  - 匿名消息 (`anonymous`)
  - 系统提示 (`notice`)

##### 通知事件 (notice)

- 群文件上传 (`group_upload`)
- 群管理员变动 (`group_admin`)
- 群成员减少 (`group_decrease`)
- 群成员增加 (`group_increase`)
- 群禁言 (`group_ban`)
- 好友添加 (`friend_add`)
- 群消息撤回 (`group_recall`)
- 好友消息撤回 (`friend_recall`)
- 群内戳一戳 (`notify.poke`)
- 群红包运气王 (`notify.lucky_king`)
- 群成员荣誉变更 (`notify.honor`)

##### 请求事件 (request)

- 加好友请求 (`friend`)
- 加群请求/邀请 (`group`)
  - 加群请求 (`add`)
  - 加群邀请 (`invite`)

##### 元事件 (meta_event)

- 生命周期 (`lifecycle`)
  - 启用 (`enable`)
  - 禁用 (`disable`)
  - 连接 (`connect`)
- 心跳 (`heartbeat`)

#### 5. 消息段类型 (CQ码)

##### 基础消息

- `text` - 纯文本
- `face` - QQ 表情
- `image` - 图片
- `record` - 语音
- `video` - 短视频
- `at` - @某人
- `rps` - 猜拳魔法表情
- `dice` - 掷骰子魔法表情
- `shake` - 戳一戳
- `poke` - 戳一戳（双击头像）
- `anonymous` - 匿名发消息
- `share` - 链接分享
- `contact` - 推荐好友/推荐群
- `location` - 位置
- `music` - 音乐分享
- `reply` - 回复
- `forward` - 合并转发
- `node` - 合并转发节点
- `xml` - XML 消息
- `json` - JSON 消息

### 配置示例

```yaml
protocols:
  - protocol: onebot
    version: v11
    use_http: true # 启用 HTTP
    use_ws: true # 启用 WebSocket
    http_reverse: # HTTP POST 上报地址
      - http://localhost:5000/onebot
    ws_reverse: # WebSocket 反向连接地址
      - ws://localhost:5000/ws
    enable_cors: true # 启用 CORS
    access_token: "" # 访问令牌
    secret: "" # 签名密钥
    post_timeout: 5000 # HTTP POST 超时时间（毫秒）
    post_message_format: "array" # 上报消息格式: string | array
    serve_data_files: false # 是否提供数据文件访问
```

### 使用示例

#### 发送消息

```typescript
// 使用 CQ 码格式
await protocol.apply("send_private_msg", {
  user_id: 12345678,
  message: "Hello [CQ:face,id=178]",
});

// 使用数组格式
await protocol.apply("send_private_msg", {
  user_id: 12345678,
  message: [
    { type: "text", data: { text: "Hello " } },
    { type: "face", data: { id: "178" } },
  ],
});
```

#### 处理事件

```typescript
protocol.on("dispatch", data => {
  const event = JSON.parse(data);

  if (event.post_type === "message") {
    console.log(`收到消息: ${event.raw_message}`);
  } else if (event.post_type === "notice") {
    console.log(`收到通知: ${event.notice_type}`);
  } else if (event.post_type === "request") {
    console.log(`收到请求: ${event.request_type}`);
  }
});
```

#### 使用 CQ 码工具

```typescript
import { CQCode } from "./cqcode";

// 解析 CQ 码
const segments = CQCode.parse("Hello [CQ:at,qq=123] [CQ:image,file=test.jpg]");

// 生成 CQ 码
const message = CQCode.stringify([CQCode.text("Hello "), CQCode.at(123), CQCode.image("test.jpg")]);

// 创建消息段
const atSegment = CQCode.at(12345678);
const imageSegment = CQCode.image("https://example.com/image.jpg", {
  cache: false,
  proxy: true,
});
const replySegment = CQCode.reply(999);
```

### 特殊说明

#### 消息 ID 转换

OneBot V11 要求消息 ID 为整数，但某些平台的消息 ID 为字符串。本实现会自动进行转换：

- 接收事件时：将字符串消息 ID 转换为整数
- 调用 API 时：将整数消息 ID 转换回原始字符串

这个转换过程是透明的，用户无需关心。

#### 平台差异

不同平台对 OneBot V11 标准的支持程度不同：

- 某些 API 可能不被特定平台支持（会抛出 "not implemented" 错误）
- 某些事件字段在特定平台上可能为空
- 建议在使用前检查相关文档

## OneBot V12

OneBot V12 是新一代的 OneBot 标准，提供了更强大和灵活的功能。

### 标准参考

- 官方仓库：https://github.com/botuniverse/onebot
- 官方文档：https://12.onebot.dev

### 特性

#### 1. 通信方式

- **HTTP**: 提供 HTTP API 接口供客户端调用
- **WebSocket**: 提供 WebSocket 连接进行实时通信
- **HTTP Webhook**: 主动推送事件到指定的 HTTP 服务器
- **WebSocket (反向)**: 主动连接到指定的 WebSocket 服务器

#### 2. 消息格式

OneBot V12 使用统一的消息段数组格式：

```json
[
  { "type": "text", "data": { "text": "Hello" } },
  { "type": "mention", "data": { "user_id": "12345" } }
]
```

#### 3. API 实现

##### 消息相关

- `send_message` - 发送消息
- `delete_message` - 删除消息

##### Bot 自身

- `get_self_info` - 获取机器人自身信息
- `get_supported_actions` - 获取支持的动作列表
- `get_status` - 获取运行状态
- `get_version` - 获取版本信息

##### 用户相关

- `get_user_info` - 获取用户信息
- `get_friend_list` - 获取好友列表

##### 群组相关

- `get_group_info` - 获取群信息
- `get_group_list` - 获取群列表
- `get_group_member_info` - 获取群成员信息
- `get_group_member_list` - 获取群成员列表
- `set_group_name` - 设置群名
- `leave_group` - 退出群组

##### 频道相关

- `get_channel_info` - 获取频道信息
- `get_channel_list` - 获取频道列表
- `set_channel_name` - 设置频道名
- `get_channel_member_info` - 获取频道成员信息
- `get_channel_member_list` - 获取频道成员列表
- `leave_channel` - 退出频道

##### 文件相关

- `upload_file` - 上传文件
- `upload_file_fragmented_*` - 分片上传文件
- `get_file` - 获取文件
- `get_file_fragmented_*` - 分片获取文件

#### 4. 事件类型

##### 消息事件 (message)

- 私聊消息 (`private`)
- 群消息 (`group`)
- 频道消息 (`channel`)

##### 通知事件 (notice)

- 群成员增加 (`group_member_increase`)
- 群成员减少 (`group_member_decrease`)
- 群消息删除 (`group_message_delete`)
- 私聊消息删除 (`private_message_delete`)
- 好友增加 (`friend_increase`)
- 好友减少 (`friend_decrease`)

##### 请求事件 (request)

（根据平台支持）

##### 元事件 (meta)

- 连接 (`connect`)
- 心跳 (`heartbeat`)
- 状态更新 (`status_update`)

#### 5. 消息段类型

- `text` - 纯文本
- `mention` - @某人
- `mention_all` - @全体成员
- `image` - 图片
- `voice` - 语音
- `audio` - 音频
- `video` - 视频
- `file` - 文件
- `location` - 位置
- `reply` - 回复

### 配置示例

```yaml
protocols:
  - protocol: onebot
    version: v12
    use_http: true # 启用 HTTP
    use_ws: true # 启用 WebSocket
    http_webhook: # HTTP webhook 上报地址
      - http://localhost:5000/onebot/v12
    ws_reverse: # WebSocket 反向连接地址
      - ws://localhost:5000/ws/v12
    enable_cors: true # 启用 CORS
    access_token: "" # 访问令牌
    heartbeat_interval: 5000 # 心跳间隔（毫秒）
```

### 使用示例

#### 发送消息

```typescript
await protocol.apply("send_message", {
  detail_type: "group",
  group_id: "123456",
  message: [
    { type: "text", data: { text: "Hello " } },
    { type: "mention", data: { user_id: "789" } },
  ],
});
```

#### 处理事件

```typescript
protocol.on("dispatch", data => {
  const event = JSON.parse(data);

  if (event.type === "message") {
    console.log(`收到消息: ${event.alt_message}`);
  } else if (event.type === "notice") {
    console.log(`收到通知: ${event.detail_type}`);
  }
});
```

### V11 vs V12 主要区别

| 特性     | OneBot V11               | OneBot V12         |
| -------- | ------------------------ | ------------------ |
| 消息格式 | CQ码/数组                | 统一数组格式       |
| API命名  | 下划线分隔               | 下划线分隔         |
| 消息ID   | 整数                     | 字符串             |
| 用户ID   | 整数                     | 字符串             |
| 事件结构 | post_type + message_type | type + detail_type |
| 平台标识 | 无                       | platform字段       |
| 频道支持 | 无                       | 原生支持           |

## 开发指南

### 添加新的 API

1. 在 `v11.ts` 的 `executeAction` 方法中添加新的 case
2. 实现对应的私有方法
3. 在 `types.ts` 中添加类型定义（如需要）
4. 更新文档

### 添加新的事件类型

1. 在 `types.ts` 中添加事件类型定义
2. 在 `convertToV11Format` 方法中添加转换逻辑
3. 更新文档

### 添加新的 CQ 码类型

1. 在 `types.ts` 中添加段类型定义
2. 在 `cqcode.ts` 中添加快捷创建方法
3. 更新 `SegmentTypes` 常量
4. 更新文档

## 测试

建议使用官方提供的测试工具进行测试：

- OneBot V11 测试工具：https://github.com/botuniverse/onebot-test

## 参考资源

- [OneBot 11 标准](https://github.com/botuniverse/onebot-11)
- [OneBot 12 标准](https://github.com/botuniverse/onebot-12)
- [CQ 码文档](https://docs.go-cqhttp.org/cqcode/)
- [go-cqhttp 文档](https://docs.go-cqhttp.org/)

## License

本项目遵循 OneBot 标准，采用 MIT 许可证。
