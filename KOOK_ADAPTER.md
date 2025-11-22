# Kook 适配器接入说明

本文档说明如何在 OneBots 项目中使用 Kook（开黑啦）平台适配器。

## 概述

Kook 适配器已成功接入 OneBots 项目，支持与 Kook 平台的完整通信功能。

## 主要特性

### ✅ 已实现功能

1. **WebSocket 连接**
   - 使用 Kook 官方 Gateway API
   - 自动获取 WebSocket 地址
   - 支持自动重连（5秒间隔）

2. **心跳机制**
   - 每 30 秒自动发送心跳
   - 保持连接活跃状态
   - 自动处理 Ping/Pong

3. **消息功能**
   - 发送文本消息
   - 发送图片、视频、文件
   - KMarkdown 格式支持
   - @提及用户/@全体成员
   - 消息删除

4. **服务器管理**
   - 获取服务器列表
   - 获取服务器信息
   - 获取服务器成员列表
   - 获取成员详细信息

5. **频道管理**
   - 获取频道列表
   - 获取频道信息
   - 获取频道成员信息

6. **事件处理**
   - 消息事件（文本、图片、视频等）
   - 系统事件（成员加入/离开、频道变更等）
   - 表情回应事件
   - 消息更新/删除事件

7. **协议支持**
   - OneBot V11
   - OneBot V12
   - Satori V1
   - Milky V1

## 快速开始

### 1. 获取 Bot Token

1. 访问 [Kook 开发者中心](https://developer.kookapp.cn/)
2. 创建应用
3. 获取 Bot Token（格式：`1/ABCDEFG/xxxxx==`）
4. 将 Bot 添加到服务器

### 2. 配置文件

在 `config.yaml` 中添加 Kook 账号配置：

```yaml
port: 6727
log_level: info
timeout: 30

# 全局默认配置（可选）
general:
  onebot.v11:
    use_http: true
    use_ws: true
    heartbeat_interval: 5

  onebot.v12:
    use_http: true
    use_ws: true
    heartbeat_interval: 5

  satori.v1:
    use_http: true
    use_ws: true

  milky.v1:
    use_http: true
    use_ws: true

# Kook 机器人配置
kook.my_bot: # 格式：{platform}.{account_id}
  # 平台特定配置（直接放在账号下）
  token: "1/ABCDEFG/aaaaaccccccccccbbbbb==" # Kook Bot Token

  # OneBot V11 协议配置
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: "my_token"
    secret: "my_secret"
    enable_cors: true
    heartbeat_interval: 5
    http_reverse: []
    ws_reverse: []

  # OneBot V12 协议配置
  onebot.v12:
    use_http: true
    use_ws: true
    access_token: "my_token"
    secret: "my_secret"
    enable_cors: true
    heartbeat_interval: 5
    webhooks: []
    ws_reverse: []

  # Satori V1 协议配置
  satori.v1:
    use_http: true
    use_ws: true
    token: "satori_token"
    platform: "kook"
    webhooks: []

  # Milky V1 协议配置
  milky.v1:
    use_http: true
    use_ws: true
    access_token: "milky_token"
    secret: "milky_secret"
    heartbeat: 5
```

**配置说明**：

- `kook.my_bot`: 账号标识，格式为 `{platform}.{account_id}`
- `config`: 平台特定配置，包含连接所需的凭证（如 Kook 的 token）
- 协议配置块：协议名和版本完全明确
  - `onebot.v11`: OneBot V11 协议配置
  - `onebot.v12`: OneBot V12 协议配置
  - `satori.v1`: Satori V1 协议配置
  - `milky.v1`: Milky V1 协议配置
- 配置继承：账号配置会继承 `general` 中对应协议版本的默认值

### 3. 启动 OneBots

```bash
npm start
```

Bot 会自动连接到 Kook 平台并开始工作。

## 消息格式转换

### Kook -> CommonEvent

```typescript
// Kook KMarkdown
"(met)123456(met) Hello!"[
  // 转换为 CommonEvent
  ({ type: "at", data: { user_id: "123456" } }, { type: "text", data: { text: " Hello!" } })
];
```

### CommonEvent -> Kook

```typescript
// CommonEvent
[
  { type: "at", data: { user_id: "123456" } },
  { type: "text", data: { text: " 你好！" } },
  { type: "image", data: { url: "https://..." } },
];

// 转换为 KMarkdown
("(met)123456(met) 你好！![](https://...)");
```

## API 映射

### 消息 API

| CommonEvent API | Kook API          | 说明          |
| --------------- | ----------------- | ------------- |
| `sendMessage`   | `/message/create` | 发送消息      |
| `deleteMessage` | `/message/delete` | 删除消息      |
| `getMessage`    | ❌ 不支持         | Kook API 限制 |

### 用户 API

| CommonEvent API | Kook API     | 说明            |
| --------------- | ------------ | --------------- |
| `getUserInfo`   | `/user/view` | 获取用户信息    |
| `getLoginInfo`  | `/user/me`   | 获取 Bot 信息   |
| `getFriendList` | ❌ 不支持    | Kook 无好友系统 |

### 服务器 API

| CommonEvent API      | Kook API           | 说明           |
| -------------------- | ------------------ | -------------- |
| `getGroupInfo`       | `/guild/view`      | 获取服务器信息 |
| `getGroupList`       | `/guild/list`      | 获取服务器列表 |
| `getGroupMemberInfo` | `/guild/user-view` | 获取成员信息   |
| `getGroupMemberList` | `/guild/user-list` | 获取成员列表   |

### 频道 API

| CommonEvent API        | Kook API           | 说明               |
| ---------------------- | ------------------ | ------------------ |
| `getChannelInfo`       | `/channel/view`    | 获取频道信息       |
| `getChannelList`       | `/channel/list`    | 获取频道列表       |
| `getChannelMemberInfo` | `/guild/user-view` | 复用服务器成员 API |
| `getChannelMemberList` | `/guild/user-list` | 复用服务器成员 API |

## 事件类型

### 消息事件

Kook 消息类型映射：

| Kook Type | 名称      | CommonEvent Type               |
| --------- | --------- | ------------------------------ |
| 1         | 文本消息  | `message`                      |
| 2         | 图片消息  | `message` (with image segment) |
| 3         | 视频消息  | `message` (with video segment) |
| 4         | 文件消息  | `message` (with file segment)  |
| 9         | KMarkdown | `message`                      |
| 10        | 卡片消息  | `message`                      |

### 系统事件

| Kook Event             | CommonEvent Type | Notice Type        |
| ---------------------- | ---------------- | ------------------ |
| `added_reaction`       | `notice`         | `message_reaction` |
| `deleted_reaction`     | `notice`         | `message_reaction` |
| `updated_message`      | `notice`         | `message_update`   |
| `deleted_message`      | `notice`         | `message_delete`   |
| `guild_member_online`  | `notice`         | `member_online`    |
| `guild_member_offline` | `notice`         | `member_offline`   |
| `added_guild`          | `notice`         | `group_increase`   |
| `deleted_guild`        | `notice`         | `group_decrease`   |
| `joined_guild`         | `notice`         | `group_increase`   |
| `exited_guild`         | `notice`         | `group_decrease`   |
| `added_channel`        | `notice`         | `channel_update`   |
| `updated_channel`      | `notice`         | `channel_update`   |
| `deleted_channel`      | `notice`         | `channel_update`   |

## KMarkdown 语法

### @提及

```
(met)user_id(met)     # @用户
(met)all(met)         # @全体成员
(rol)role_id(rol)     # @角色
```

### 表情

```
(emj)emoji_id(emj)[emoji_name]
```

### 图片

```
![alt text](image_url)
```

### 链接

```
[link text](url)
```

## 技术架构

### 类结构

```
KookAdapter (extends Adapter)
├── clients: Map<uin, Client>
├── utils: KookUtils
├── createAccount()
├── start()
├── stop()
├── connectWebSocket()
├── handleWebSocketMessage()
├── handleEvent()
└── request()

KookUtils
├── transformEvent()
├── transformMessageEvent()
├── transformSystemEvent()
├── parseKMarkdown()
├── segmentsToKMarkdown()
└── parseRole()
```

### WebSocket 流程

```
1. 获取 Gateway URL
   ↓
2. 连接 WebSocket
   ↓
3. 接收 Hello (s: 1)
   ↓
4. 启动心跳 (每 30s 发送 Ping)
   ↓
5. 接收事件 (s: 0)
   ↓
6. 处理并分发到协议
```

### 心跳机制

```javascript
// 每 30 秒发送一次 Ping
{
  "s": 2,        // Ping signal
  "sn": 123      // 序列号
}

// 服务器返回 Pong
{
  "s": 3         // Pong signal
}
```

### 自动重连

```javascript
ws.on("close", () => {
  // 5 秒后重连
  setTimeout(() => {
    start(uin);
  }, 5000);
});
```

## 注意事项

### 1. Token 安全

⚠️ **重要**: 不要将 Bot Token 提交到公开仓库！

使用环境变量：

```yaml
kook.my_bot:
  versions:
    - version: V11
  protocol:
    token: ${KOOK_BOT_TOKEN} # 使用环境变量
```

### 2. 速率限制

Kook API 速率限制：

- 全局: 120 次/分钟
- 单个接口: 5 次/秒

超出限制会返回 429 错误。

### 3. 权限配置

确保 Bot 有以下权限：

- 查看频道
- 发送消息
- 管理消息（如需删除消息）
- 连接语音频道（如需语音功能）

### 4. 消息格式

- 使用 KMarkdown 时注意转义特殊字符
- 图片、视频需要先上传获取 URL
- @提及需要正确的用户 ID

### 5. 事件处理

- 事件是异步处理的
- 确保处理器不会阻塞
- 大量事件时注意性能

## 故障排查

### 连接失败

**问题**: WebSocket 连接失败

**解决方案**:

1. 检查 Token 是否正确
2. 检查网络连接
3. 查看日志获取详细错误信息
4. 确认 Kook API 服务正常

### 收不到消息

**问题**: Bot 在线但收不到消息

**解决方案**:

1. 检查 WebSocket 连接状态
2. 确认心跳正常
3. 检查 Bot 是否在频道中
4. 查看事件处理日志

### 发送消息失败

**问题**: 消息发送失败

**解决方案**:

1. 确认 Bot 在目标频道中
2. 检查 Bot 权限
3. 确认频道 ID 正确
4. 检查消息格式是否正确

### API 调用失败

**问题**: API 返回错误

**解决方案**:

1. 检查速率限制
2. 确认参数正确
3. 查看 Kook API 文档
4. 检查 Bot 权限

## 示例代码

假设你的配置是 `kook.my_bot`，Bot 会在以下路径提供 API：

- OneBot V11: `http://localhost:6727/kook/my_bot/V11/`
- OneBot V12: `http://localhost:6727/kook/my_bot/V12/`

### 通过 OneBot V11 发送消息

```bash
# 发送频道消息
curl -X POST http://localhost:6727/kook/my_bot/V11/send_msg \
  -H "Authorization: Bearer your_access_token" \
  -H "Content-Type: application/json" \
  -d '{
    "message_type": "group",
    "group_id": "channel_id",
    "message": [
      {"type": "at", "data": {"qq": "123456"}},
      {"type": "text", "data": {"text": " Hello from Kook!"}}
    ]
  }'
```

### 通过 OneBot V12 发送消息

```bash
# 发送频道消息
curl -X POST http://localhost:6727/kook/my_bot/V12/call \
  -H "Authorization: Bearer your_access_token" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "send_message",
    "params": {
      "detail_type": "channel",
      "channel_id": "channel_id",
      "message": [
        {"type": "mention", "data": {"user_id": "123456"}},
        {"type": "text", "data": {"text": " Hello from Kook!"}}
      ]
    }
  }'
```

### WebSocket 连接示例

```javascript
// OneBot V11 WebSocket
const ws = new WebSocket("ws://localhost:6727/kook/my_bot/V11/ws");

ws.on("open", () => {
  console.log("Connected to Kook bot via OneBot V11");
});

ws.on("message", data => {
  const event = JSON.parse(data);
  console.log("Received event:", event);

  // 响应消息
  if (event.post_type === "message") {
    ws.send(
      JSON.stringify({
        action: "send_msg",
        params: {
          message_type: event.message_type,
          group_id: event.group_id,
          message: "Hello!",
        },
        echo: "reply_1",
      }),
    );
  }
});
```

## 依赖项

Kook 适配器需要以下依赖：

```json
{
  "dependencies": {
    "ws": "^8.0.0"
  }
}
```

如果尚未安装，请运行：

```bash
npm install ws
```

## 测试

### 手动测试

1. 配置 Bot Token
2. 启动 OneBots
3. 在 Kook 服务器中发送消息
4. 查看日志确认消息接收
5. 通过协议 API 发送消息
6. 在 Kook 中查看消息

### 自动化测试

```bash
npm test -- --grep "Kook"
```

## 性能优化

1. **消息批量处理**: 合并多个消息操作
2. **事件队列**: 避免事件处理阻塞
3. **连接池**: 复用 HTTP 连接
4. **缓存**: 缓存频繁访问的数据

## 未来计划

- [ ] 语音频道支持
- [ ] 卡片消息支持
- [ ] 按钮交互支持
- [ ] 更多事件类型
- [ ] 文件上传优化
- [ ] WebSocket 压缩支持

## 参考资料

- [Kook 开发者文档](https://developer.kookapp.cn/doc/)
- [Kook Bot API 参考](https://developer.kookapp.cn/doc/reference)
- [KMarkdown 语法](https://developer.kookapp.cn/doc/kmarkdown)
- [OneBots 项目文档](./README.md)
- [协议架构文档](./PROTOCOLS.md)

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

与 OneBots 项目保持一致。
