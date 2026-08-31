# Discord 适配器

Discord 适配器已完全实现，支持通过 Discord Bot API 接入 onebots 服务。

## 状态

✅ **已实现并可用**

## 功能特性

- ✅ **消息收发**
  - 频道消息收发
  - 私聊消息收发
  - 支持文本、图片、音频、视频、文件等多种消息格式
- ✅ **服务器（Guild）管理**
  - 获取服务器列表和信息
  - 退出服务器
- ✅ **频道管理**
  - 获取频道列表和信息
  - 创建、更新、删除频道
- ✅ **成员管理**
  - 获取成员信息
  - 踢出成员
  - 禁言成员
  - 设置成员昵称
- ✅ **消息反应**
  - 添加/移除消息反应
- ✅ **Embed 消息**
  - 支持富文本 Embed 消息

## 安装

```bash
npm install @onebots/adapter-discord discord.js
# 或
pnpm add @onebots/adapter-discord discord.js
```

## 配置

在 `config.yaml` 中配置 Discord 账号：

```yaml
# Discord 机器人账号配置
discord.your_bot_id:
  # Discord 平台配置
  token: 'your_discord_bot_token'  # Discord Bot Token，必填
  intents:  # 可选，Gateway Intents
    - Guilds
    - GuildMessages
    - GuildMembers
    - GuildMessageReactions
    - DirectMessages
    - DirectMessageReactions
    - MessageContent
  partials:  # 可选，Partials
    - Message
    - Channel
    - Reaction
  presence:  # 可选，机器人状态
    status: online  # online, idle, dnd, invisible
    activities:
      - name: '正在运行 onebots'
        type: 0  # 0: Playing, 1: Streaming, 2: Listening, 3: Watching, 5: Competing
  
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
| `token` | string | 是 | Discord Bot Token |
| `intents` | string[] | 否 | Gateway Intents，需要接收的事件类型 |
| `partials` | string[] | 否 | Partials，部分数据支持 |
| `presence` | object | 否 | 机器人状态和活动 |

### 必需的 Intents

根据你的机器人功能，可能需要启用以下 Privileged Intents：

- **PRESENCE INTENT** - 如果需要在状态中显示成员信息
- **SERVER MEMBERS INTENT** - 如果需要获取服务器成员列表
- **MESSAGE CONTENT INTENT** - 如果需要读取消息内容（必需）

## 获取 Token

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 点击 "New Application" 创建新应用
3. 进入应用后，点击左侧 "Bot" 菜单
4. 点击 "Reset Token" 获取 Bot Token
5. 在 "Privileged Gateway Intents" 中启用需要的 Intents

## 邀请机器人到服务器

1. 在 Discord Developer Portal 中，进入你的应用
2. 点击左侧 "OAuth2" -> "URL Generator"
3. 在 "SCOPES" 中选择 `bot`
4. 在 "BOT PERMISSIONS" 中选择需要的权限
5. 复制生成的 URL 并在浏览器中打开
6. 选择要添加机器人的服务器

## 启动服务

```bash
# 启动 onebots 服务，加载 Discord 适配器
onebots -r discord -p onebot-v11 -p onebot-v12 -c config.yaml
```

## 使用客户端SDK连接

```typescript
import { createImHelper } from 'imhelper';
import { createOnebot11Adapter } from '@imhelper/onebot-v11';

const adapter = createOnebot11Adapter({
  baseUrl: 'http://localhost:6727',
  selfId: 'your_bot_id',
  accessToken: 'your_v11_token',
  receiveMode: 'ws',
  path: '/discord/your_bot_id/onebot/v11',
  wsUrl: 'ws://localhost:6727/discord/your_bot_id/onebot/v11',
  platform: 'discord',
});

const helper = createImHelper(adapter);
await adapter.connect();
```

详细说明请查看：[客户端SDK使用指南](/guide/client-sdk)

## 支持的 API

### 消息相关
- `sendMessage` - 发送消息（支持私信、频道消息）
- `deleteMessage` - 删除/撤回消息
- `getMessage` - 获取消息
- `getMessageHistory` - 获取历史消息

### 用户相关
- `getLoginInfo` - 获取机器人信息
- `getUserInfo` - 获取用户信息

### 服务器相关
- `getGroupList` - 获取服务器列表
- `getGroupInfo` - 获取服务器信息
- `leaveGroup` - 退出服务器
- `getGroupMemberList` - 获取服务器成员列表
- `getGroupMemberInfo` - 获取成员信息
- `kickGroupMember` - 踢出成员
- `muteGroupMember` - 禁言成员
- `setGroupCard` - 设置成员昵称

### 频道相关
- `getChannelList` - 获取频道列表
- `getChannelInfo` - 获取频道信息
- `createChannel` - 创建频道
- `updateChannel` - 更新频道
- `deleteChannel` - 删除频道

## 事件类型

### 消息事件
- `message.guild` - 频道消息
- `message.private` - 私聊消息

### 通知事件
- `guild_create` / `guild_delete` - 服务器加入/离开
- `guild_member_add` / `guild_member_remove` - 成员加入/离开
- `channel_create` / `channel_delete` - 频道创建/删除
- `message_reaction_add` / `message_reaction_remove` - 消息反应

## 注意事项

1. **权限配置**：确保机器人拥有足够的权限执行相应操作
2. **Intents 配置**：需要在 Discord Developer Portal 中启用对应的 Privileged Intents
3. **消息内容**：要接收消息内容，需要启用 MESSAGE CONTENT INTENT
4. **速率限制**：Discord API 有速率限制，请勿频繁调用

## 相关链接

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord.js 文档](https://discord.js.org/)
- [@onebots/adapter-discord README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-discord)
- [客户端SDK使用指南](/guide/client-sdk)

