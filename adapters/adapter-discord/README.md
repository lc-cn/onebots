# @onebots/adapter-discord

onebots Discord 适配器 - 轻量版实现，直接封装 Discord API，无外部依赖。

## 特性

- ✅ **轻量级**：不依赖 discord.js，包体积小
- ✅ **多运行时**：支持 Node.js、Cloudflare Workers、Vercel Edge
- ✅ **原生 fetch**：使用原生 API，兼容性好
- ✅ **代理支持**：使用 https-proxy-agent（可选）

## 安装

```bash
npm install @onebots/adapter-discord

# Node.js Gateway 模式需要 ws
npm install ws

# 需要代理时
npm install https-proxy-agent
```

## 配置

在 onebots 配置文件中添加 Discord 账号配置：

```yaml
discord.your_bot_id:
  token: "your_discord_bot_token" # Discord Bot Token，必填

  # 代理配置（可选）
  proxy:
    url: "http://127.0.0.1:7890"
    # username: "user"  # 可选
    # password: "pass"  # 可选

  intents: # 可选，Gateway Intents
    - Guilds
    - GuildMessages
    - GuildMembers
    - GuildMessageReactions
    - DirectMessages
    - DirectMessageReactions
    - MessageContent
  presence: # 可选，机器人状态
    status: online # online, idle, dnd, invisible
    activities:
      - name: "正在运行 onebots"
        type: 0 # 0: Playing, 1: Streaming, 2: Listening, 3: Watching, 5: Competing
```

Web 管理端会把 Gateway Intents 渲染为可搜索、可增减的选项列表，并将凭据、事件订阅、发送表现与高级网络设置分区展示，无需手写数组 JSON。

## 独立使用（不依赖 onebots）

### Node.js Gateway 模式

```typescript
import { DiscordLite, GatewayIntents } from "@onebots/adapter-discord/lite";

const client = new DiscordLite({
  token: process.env.DISCORD_TOKEN,
  intents: GatewayIntents.Guilds | GatewayIntents.GuildMessages | GatewayIntents.MessageContent,
  mode: "gateway",
  proxy: { url: "http://127.0.0.1:7890" }, // 可选
});

client.on("ready", user => {
  console.log(`已登录为 ${user.username}`);
});

client.on("messageCreate", async message => {
  if (message.content === "!ping") {
    await client.sendMessage(message.channel_id, "Pong!");
  }
});

await client.start();
```

### Cloudflare Workers 模式

```typescript
import { InteractionsHandler } from "@onebots/adapter-discord/lite";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const handler = new InteractionsHandler({
      publicKey: env.DISCORD_PUBLIC_KEY,
      token: env.DISCORD_TOKEN,
      applicationId: env.DISCORD_APP_ID,
    });

    handler.onCommand("ping", async () => {
      return InteractionsHandler.messageResponse("🏓 Pong!");
    });

    return handler.handleRequest(request);
  },
};
```

### 直接使用 REST API

```typescript
import { DiscordREST } from "@onebots/adapter-discord/lite";

const rest = new DiscordREST({ token: process.env.DISCORD_TOKEN });

// 发送消息
await rest.createMessage("channel_id", "Hello!");

// 获取用户
const user = await rest.getUser("user_id");
```

## 获取 Discord Bot Token

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 点击 "New Application" 创建新应用
3. 进入应用后，点击左侧 "Bot" 菜单
4. 点击 "Reset Token" 获取 Bot Token
5. 在 "Privileged Gateway Intents" 中启用需要的 Intents

## 支持的 API

### 消息相关

- ✅ sendMessage - 发送消息
- ✅ deleteMessage - 删除消息
- ✅ getMessage - 获取消息
- ✅ getMessageHistory - 获取历史消息

### 用户相关

- ✅ getLoginInfo - 获取机器人信息
- ✅ getUserInfo - 获取用户信息

### 群组（服务器）相关

- ✅ getGroupList - 获取服务器列表
- ✅ getGroupInfo - 获取服务器信息
- ✅ leaveGroup - 退出服务器
- ✅ getGroupMemberList - 获取成员列表
- ✅ getGroupMemberInfo - 获取成员信息
- ✅ kickGroupMember - 踢出成员
- ✅ muteGroupMember - 禁言成员
- ✅ setGroupCard - 设置昵称

### 频道相关

- ✅ getChannelInfo - 获取频道信息
- ✅ getChannelList - 获取频道列表
- ✅ createChannel - 创建频道
- ✅ deleteChannel - 删除频道
- ✅ updateChannel - 更新频道

### Discord 原生扩展

能力列表可通过协议的 `get_supported_actions` 查询，所有协议都可以用 snake_case 动作名调用。扩展按 Discord v10 资源模型分组：

- 成员：`ban_member`、`unban_member`、`get_guild_bans`
- 角色：`get_guild_roles`、`create_guild_role`、`update_guild_role`、 `delete_guild_role`、`add_guild_member_role`、`remove_guild_member_role`
- 消息：`bulk_delete_messages`、`crosspost_message`、`get_channel_pins`、 `pin_message`、`unpin_message`、`get_reaction_users`、`trigger_typing`
- 线程：`create_thread`、`join_thread`、`leave_thread`、`add_thread_member`、 `remove_thread_member`、`list_thread_members`、`get_active_threads`
- 邀请：`get_channel_invites`、`create_channel_invite`、`delete_invite`

Gateway 的消息编辑/删除、Reaction、成员变化和 Interaction 会投影为标准事件；其他 Dispatch 以 `notice.custom` + `raw_event` 无损交付。

## 依赖说明

本适配器采用轻量级设计，核心功能无需外部依赖。以下为可选依赖：

| 依赖                | 何时需要                           | 安装命令                        |
| ------------------- | ---------------------------------- | ------------------------------- |
| `ws`                | Node.js Gateway 模式               | `npm install ws`                |
| `https-proxy-agent` | 使用 HTTP/HTTPS 代理（REST API）   | `npm install https-proxy-agent` |
| `socks-proxy-agent` | 使用 SOCKS5 代理（WebSocket 推荐） | `npm install socks-proxy-agent` |

### 常见问题

#### 1. 连接超时 / ECONNRESET

如果你在中国大陆等需要代理的地区，请配置代理：

```yaml
discord.your_bot:
  token: "xxx"
  proxy:
    url: "http://127.0.0.1:7890" # 你的代理地址
```

并安装代理依赖：

```bash
# 推荐同时安装（WebSocket 使用 SOCKS5 更稳定）
npm install https-proxy-agent socks-proxy-agent
```

#### 2. 缺少 ws 模块

如果看到 `Cannot find module 'ws'` 错误：

```bash
npm install ws
```

> **注意**：Cloudflare Workers 模式（Interactions）不需要 `ws`

#### 3. WebSocket 连接失败但 REST API 正常

某些代理软件（如 Clash）的 HTTP 代理模式对 WebSocket 支持不佳。适配器会自动将 HTTP 代理转换为 SOCKS5，但需要：

1. 确保代理软件开启了混合端口（同时支持 HTTP 和 SOCKS5）
2. 安装 `socks-proxy-agent`：`npm install socks-proxy-agent`

## 许可证

MIT
