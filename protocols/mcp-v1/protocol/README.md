# @onebots/protocol-mcp-v1

OneBots MCP (Model Context Protocol) v1 协议插件。

将 IM 平台能力暴露为标准化 MCP 工具，让 Cursor、Claude Code、Cline 等 AI Agent 可以直接发消息、管理群组、处理好友请求。

## 安装

```bash
pnpm add @onebots/protocol-mcp-v1
# 或
npm install @onebots/protocol-mcp-v1
```

## 配置

在 `config.yaml` 中为账号启用 MCP 协议：

```yaml
qq.my-bot:
  appid: "xxx"
  secret: "xxx"
  mcp.v1: # 启用即可，下面都是可选项
    access_token: "your-token" # Bearer Token 鉴权
    tools_whitelist: [] # 工具白名单（留空 = 全部启用）
    tools_blacklist: [] # 工具黑名单
```

## 传输方式

### stdio（推荐）

AI Agent 通过 stdin/stdout 直接通信，无需网络配置：

```bash
onebots mcp --config config.yaml --account qq/my-bot
```

### HTTP/SSE

随 OneBots 服务启动，适用于远程访问：

- SSE 连接: `GET /{platform}/{account_id}/mcp/v1/sse`
- 消息端点: `POST /{platform}/{account_id}/mcp/v1/message`

## AI Agent 配置

::: code-group

```json [Cursor (~/.cursor/mcp.json)]
{
  "mcpServers": {
    "onebots": {
      "command": "npx",
      "args": ["onebots", "mcp", "--config", "/path/to/config.yaml", "--account", "qq/my-bot"]
    }
  }
}
```

```json [Claude Code (~/.claude/claude_code_config.json)]
{
  "mcpServers": {
    "onebots": {
      "command": "npx",
      "args": ["onebots", "mcp", "--config", "/path/to/config.yaml", "--account", "qq/my-bot"]
    }
  }
}
```

```json [Cline (VS Code)]
{
  "cline.mcpServers": {
    "onebots": {
      "command": "npx",
      "args": ["onebots", "mcp", "--config", "/path/to/config.yaml", "--account", "qq/my-bot"]
    }
  }
}
```

:::

> 全局安装了 onebots 的用户可以将 `"command"` 改为 `"onebots"`，并从 `args` 中移除 `"onebots"`。

## 可用工具（31 个）

| 分类 | 查询                                                                                                                      | 操作                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 消息 | `get_message`                                                                                                             | `send_message` `delete_message`                                                                                                                   |
| 用户 | `get_login_info` `get_user_info`                                                                                          | —                                                                                                                                                 |
| 好友 | `get_friend_list` `get_friend_info`                                                                                       | `handle_friend_request` `delete_friend`                                                                                                           |
| 群组 | `get_group_list` `get_group_info` `get_group_member_list` `get_group_member_info`                                         | `set_group_name` `leave_group` `kick_group_member` `mute_group_member` `mute_group_all` `set_group_admin` `set_group_card` `handle_group_request` |
| 频道 | `get_guild_list` `get_guild_info` `get_channel_list` `get_channel_info` `get_guild_member_info` `get_channel_member_list` | —                                                                                                                                                 |
| 文件 | —                                                                                                                         | `upload_file`                                                                                                                                     |
| 系统 | `get_supported_actions` `get_status` `get_version`                                                                        | —                                                                                                                                                 |

工具参数遵循 JSON Schema 原生类型，布尔字段必须传 `true` / `false`，不会把字符串或其他 truthy 值静默转换。好友删除、好友申请和群申请工具支持可选 `block` 策略；不支持该语义的适配器会显式返回错误。
