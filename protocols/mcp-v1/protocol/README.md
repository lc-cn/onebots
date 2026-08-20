# @onebots/protocol-mcp-v1

OneBots MCP (Model Context Protocol) v1 协议插件。让 AI Agent（Cursor、Claude Code、Cline 等）通过标准化接口调用 IM 能力。

## 安装

```bash
pnpm add @onebots/protocol-mcp-v1
# 或
npm install @onebots/protocol-mcp-v1
```

## OneBots 配置

在 `config.yaml` 对应账号下启用 MCP 协议：

```yaml
qq:
  my-bot:
    appid: "xxx"
    secret: "xxx"
    mcp.v1:
      access_token: "your-token"    # 可选，鉴权 token
      tools_whitelist: []           # 可选，工具白名单（留空 = 全部启用）
      tools_blacklist: []           # 可选，工具黑名单
```

## 传输方式

### 1. stdio（推荐用于 Cursor / Claude Code）

通过 stdin/stdout 进行 JSON-RPC 通信，无需额外网络配置。

```bash
onebots mcp --config config.yaml --account qq/my-bot
```

### 2. HTTP/SSE（适用于 Web 客户端和远程连接）

启动 OneBots 后自动在 HTTP 路由上暴露：

- SSE 连接: `GET /{platform}/{account_id}/mcp/v1/sse`
- 消息端点: `POST /{platform}/{account_id}/mcp/v1/message`

## Agent 配置示例

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "onebots": {
      "command": "npx",
      "args": ["onebots", "mcp", "--config", "/path/to/config.yaml", "--account", "qq/my-bot"],
      "env": {}
    }
  }
}
```

### Claude Code (`~/.claude/claude_code_config.json`)

```json
{
  "mcpServers": {
    "onebots": {
      "command": "npx",
      "args": ["onebots", "mcp", "--config", "/path/to/config.yaml", "--account", "qq/my-bot"]
    }
  }
}
```

### Cline (VS Code 设置)

```json
{
  "cline.mcpServers": {
    "onebots": {
      "command": "npx",
      "args": ["onebots", "mcp", "--config", "/path/to/config.yaml", "--account", "qq/my-bot"]
    }
  }
}
```

如果使用 pnpm 全局安装了 onebots，可以将 `"command": "npx"` 替换为 `"command": "onebots"`，并从 `args` 中移除 `"onebots"`。

## 可用工具（Tools）

MCP v1 暴露 32 个工具，覆盖消息、好友、群组、频道、文件和系统操作：

| 分类     | 工具                                                                                         |
| -------- | -------------------------------------------------------------------------------------------- |
| 消息     | `send_message` `delete_message` `get_message`                                                |
| 用户     | `get_login_info` `get_user_info`                                                             |
| 好友     | `get_friend_list` `get_friend_info` `handle_friend_request` `delete_friend`                  |
| 群组     | `get_group_list` `get_group_info` `get_group_member_list` `get_group_member_info`             |
|          | `set_group_name` `leave_group` `kick_group_member` `mute_group_member` `mute_group_all`      |
|          | `set_group_admin` `set_group_card` `handle_group_request`                                    |
| 频道     | `get_guild_list` `get_guild_info` `get_channel_list` `get_channel_info`                      |
|          | `get_guild_member_info` `get_channel_member_list`                                            |
| 文件     | `upload_file`                                                                                |
| 系统     | `get_supported_actions` `get_status` `get_version`                                           |
