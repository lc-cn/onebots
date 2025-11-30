# Satori 协议

Satori 是一个现代化的跨平台聊天机器人协议，由 Koishi 团队开发和维护。

## 协议简介

Satori 协议的特点：

- 🌐 **真正的跨平台**: 统一的消息格式和 API，无缝支持多平台
- 🎯 **类型安全**: 完整的 TypeScript 类型定义
- 🔄 **实时通信**: 基于 WebSocket 的双向通信
- 📦 **消息元素**: 使用类 HTML 的消息元素表示富文本
- 🚀 **现代化设计**: 吸收了各大协议的优点

## 安装

```bash
npm install @onebots/protocol-satori-v1
```

## 配置

在 `config.yaml` 中配置 Satori 协议：

```yaml
# 全局默认配置
general:
  satori.v1:
    path: /satori          # WebSocket 路径
    token: "your_token"    # 访问令牌（可选）

# 账号配置
wechat.my_mp:
  satori.v1:
    path: /satori
    token: "account_token"
```

## 通信方式

Satori 协议基于 WebSocket 通信。

### WebSocket 连接

**地址格式**: `ws://localhost:6727/{platform}/{account_id}/satori`

**连接示例**:
```javascript
const ws = new WebSocket('ws://localhost:6727/wechat/my_mp/satori');

ws.on('open', () => {
  // 发送认证
  ws.send(JSON.stringify({
    op: 3, // IDENTIFY
    body: {
      token: 'your_token'
    }
  }));
});

ws.on('message', (data) => {
  const payload = JSON.parse(data);
  console.log('Received:', payload);
});
```

## 消息元素

Satori 使用类 HTML 的消息元素：

```html
<message>
  <text>Hello </text>
  <at id="123456"/>
  <image url="https://example.com/image.jpg"/>
</message>
```

常用元素：

- `<text>` - 纯文本
- `<at>` - @提及
- `<image>` - 图片
- `<audio>` - 语音
- `<video>` - 视频
- `<file>` - 文件
- `<quote>` - 引用回复

## API 列表

### 消息相关

- `message.create` - 发送消息
- `message.get` - 获取消息
- `message.delete` - 删除消息
- `message.update` - 编辑消息
- `message.list` - 获取消息列表

### 频道相关

- `channel.get` - 获取频道信息
- `channel.list` - 获取频道列表
- `channel.create` - 创建频道
- `channel.update` - 修改频道信息
- `channel.delete` - 删除频道

### 群组相关

- `guild.get` - 获取群组信息
- `guild.list` - 获取群组列表
- `guild.member.get` - 获取成员信息
- `guild.member.list` - 获取成员列表
- `guild.member.kick` - 移除成员

### 用户相关

- `user.get` - 获取用户信息
- `friend.list` - 获取好友列表

## 事件类型

Satori 事件统一使用 `Event` 格式：

```typescript
interface Event {
  id: number
  type: string
  platform: string
  self_id: string
  timestamp: number
  channel?: Channel
  guild?: Guild
  user?: User
  member?: GuildMember
  message?: Message
}
```

常见事件类型：

- `message-created` - 消息创建
- `message-deleted` - 消息删除
- `guild-member-added` - 成员加入
- `guild-member-removed` - 成员退出
- `friend-request` - 好友申请

## 平台支持

Satori 协议已在以下平台得到验证：

- Discord
- Telegram  
- QQ（通过各种实现）
- Kook
- 微信（通过 OneBots）

## 在 Koishi 中使用

Koishi 原生支持 Satori 协议：

```yaml
# Koishi 配置
plugins:
  adapter-satori:
    endpoint: ws://localhost:6727/wechat/my_mp/satori
    token: your_token
```

## 优势对比

### vs OneBot V11/V12

- ✅ 更现代的消息格式（类 HTML vs CQ 码/JSON）
- ✅ 原生跨平台设计
- ✅ 更好的类型系统
- ✅ 实时双向通信

### vs 其他协议

- ✅ 更简洁的 API 设计
- ✅ 完整的文档和类型定义
- ✅ 活跃的社区支持

## 相关链接

- [Satori 协议规范](https://satori.js.org/)
- [Koishi 文档](https://koishi.chat/)
- [@onebots/protocol-satori README](https://github.com/lc-cn/onebots/tree/master/packages/protocol-satori)
