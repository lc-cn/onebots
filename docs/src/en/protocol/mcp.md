# MCP Protocol

MCP (Model Context Protocol) is an open protocol by Anthropic for standardizing how AI Agents interact with external tools. OneBots exposes IM platform capabilities as MCP tools, allowing AI coding assistants like Cursor, Claude Code, and Cline to directly operate on messages, groups, friends, and more.

## Quick Start

Three steps to connect an AI Agent to your IM platform:

**Step 1: Install and Configure**

```bash
npm install onebots @onebots/protocol-mcp-v1
```

Enable MCP in `config.yaml`:

```yaml
qq.my-bot:
  appid: "your-appid"
  secret: "your-secret"
  mcp.v1: {}                    # Enable with defaults
```

**Step 2: Configure Your AI Agent**

For Cursor, add to `~/.cursor/mcp.json`:

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

**Step 3: Start Using**

Tell your AI: "Send a message to group 123456" — it will automatically call the `send_message` tool.

## Features

- **AI Agent Native**: Built for Cursor, Claude Code, Cline, and similar assistants
- **Standardized Tools**: JSON-RPC 2.0, MCP 2025-03-26 spec compliant
- **Dual Transport**: stdio (local) and HTTP/SSE (remote)
- **Access Control**: Bearer Token auth + tool whitelist/blacklist

## Installation

```bash
# Server plugin (required)
npm install @onebots/protocol-mcp-v1

# Client SDK (only for programmatic access — AI Agents don't need this)
npm install @onebots/mcp-client
```

## Configuration

### Basic

```yaml
qq.my-bot:
  appid: "xxx"
  secret: "xxx"
  mcp.v1: {}                    # Defaults are fine
```

### Full

```yaml
general:
  mcp.v1:
    access_token: "your_token"
    tools_blacklist:
      - kick_group_member
      - delete_friend

qq.my-bot:
  appid: "xxx"
  secret: "xxx"
  mcp.v1:
    access_token: "bot-specific-token"    # Bearer token
    tools_whitelist: []                   # Empty = all enabled
    tools_blacklist: []                   # Tools to hide
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `access_token` | string | none | Bearer Token auth; empty = no auth |
| `tools_whitelist` | string[] | [] | Only expose listed tools; empty = all |
| `tools_blacklist` | string[] | [] | Hide listed tools |

## Transport

### stdio (Recommended)

JSON-RPC over stdin/stdout. The standard connection method for desktop AI Agents — no network config needed.

```bash
onebots mcp --config config.yaml --account qq/my-bot
```

The stdio command reuses the exact MCP plugin entry that passed the registration contract during this startup. It does not resolve another copy relative to the `onebots` package, so npm projects, strict pnpm layouts, and workspace members all use the same version the gateway loaded. If account selection, protocol configuration, or the stdio export check fails, the command stops the accounts, protocols, and listeners it already started before returning the error. Repeated stdin close signals also trigger only one stop.

### HTTP/SSE (Remote)

Automatically exposed when OneBots starts:

| Endpoint | Method | Description |
| --- | --- | --- |
| `/{platform}/{account_id}/mcp/v1/sse` | GET | SSE stream for events |
| `/{platform}/{account_id}/mcp/v1/message` | POST | JSON-RPC requests |

Flow: GET `/sse` → receive `endpoint` event → POST requests to that endpoint → responses and events arrive via SSE.

## AI Agent Configuration

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

```json [Cline (VS Code settings)]
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

## Available Tools

MCP v1 exposes 32 tools. Each accepts JSON arguments and returns structured results.

### Read-Only

| Tool | Description |
| --- | --- |
| `get_login_info` | Current bot account info (ID, name, avatar) |
| `get_user_info` | User info by ID |
| `get_friend_list` | Friend list |
| `get_friend_info` | Friend info by ID |
| `get_group_list` | Group list |
| `get_group_info` | Group info by ID |
| `get_group_member_list` | Group member list |
| `get_group_member_info` | Group member details |
| `get_guild_list` | Joined guild list |
| `get_guild_info` | Guild details |
| `get_channel_list` | Channel list in a guild |
| `get_channel_info` | Channel details |
| `get_guild_member_info` | Guild member info |
| `get_channel_member_list` | Channel member list |
| `get_message` | Message details by ID |
| `get_supported_actions` | Supported API list |
| `get_status` | Bot runtime status |
| `get_version` | Implementation version |

### Actions

| Tool | Description | Risk |
| --- | --- | --- |
| `send_message` | Send message (group/private/channel) | Low |
| `delete_message` | Recall/delete a message | Low |
| `upload_file` | Upload file (image/video/audio/file) | Low |
| `handle_friend_request` | Accept/reject friend request | Medium |
| `handle_group_request` | Accept/reject group join request | Medium |
| `set_group_name` | Set group name | Medium |
| `set_group_card` | Set member card/nickname | Medium |
| `set_group_admin` | Set/unset group admin | Medium |
| `mute_group_member` | Mute a group member | High |
| `mute_group_all` | Mute/unmute all members | High |
| `kick_group_member` | Kick a group member | High |
| `delete_friend` | Delete a friend | High |
| `leave_group` | Leave a group | High |

### Tool Filtering

```yaml
mcp.v1:
  # Whitelist — only expose these tools
  tools_whitelist:
    - get_login_info
    - get_group_list
    - get_friend_list
    - send_message

  # Or blacklist — block dangerous operations
  tools_blacklist:
    - kick_group_member
    - mute_group_member
    - mute_group_all
    - delete_friend
    - leave_group
```

## Event Push

After connection, MCP pushes platform events in real time as JSON-RPC notifications.

### Message Events

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/message",
  "params": {
    "platform": "qq",
    "account_id": "my-bot",
    "message_type": "group",
    "message_id": "123",
    "sender": { "id": "456", "name": "User A" },
    "group": { "id": "789", "name": "Test Group" },
    "raw_message": "Hello",
    "timestamp": 1700000000
  }
}
```

### Notice Events

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/notice",
  "params": {
    "platform": "qq",
    "account_id": "my-bot",
    "notice_type": "group_member_increase",
    "user": { "id": "456", "name": "New Member" },
    "group": { "id": "789", "name": "Test Group" },
    "timestamp": 1700000000
  }
}
```

## Client SDK

For programmatic access (not via AI Agent):

```bash
npm install @onebots/mcp-client
```

```typescript
import { McpStdioClient } from '@onebots/mcp-client';

const client = new McpStdioClient({
  command: 'onebots',
  args: ['mcp', '--config', 'config.yaml', '--account', 'qq/my-bot'],
});

await client.connect();

const tools = await client.listTools();
const result = await client.callTool('send_message', {
  scene_type: 'group',
  scene_id: '123456',
  message: 'Hello from MCP!',
});

await client.close();
```

See [Client SDK Guide](/en/guide/client-sdk) for more details.

## Protocol Comparison

| | MCP | OneBot V11/V12 | Satori | Milky |
| --- | --- | --- | --- | --- |
| **Purpose** | AI Agent tool calls | Bot framework integration | Cross-platform unified | Lightweight direct |
| **Wire Protocol** | JSON-RPC 2.0 | HTTP / WebSocket | WebSocket | HTTP / WebSocket |
| **Transport** | stdio / HTTP+SSE | HTTP / WS / Reverse WS | WebSocket | HTTP / WS |
| **Message Format** | Plain text (LLM-friendly) | CQ codes / segments | HTML elements | Segments |
| **Typical Clients** | Cursor, Claude Code | NoneBot2, Koishi | Koishi | Custom apps |
| **Best For** | AI automation | Mature ecosystem | Modern cross-platform | Simple and direct |

## Related Links

- [Protocol Configuration](/en/config/protocol)
- [Client SDK Guide](/en/guide/client-sdk)
- [MCP Specification](https://modelcontextprotocol.io/)
