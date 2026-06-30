# ADR-0004: MCP v1 协议设计

- **状态**: 已接受（设计有效；**实施推迟至 Q4**，见 ADR-0002/0003）
- **日期**: 2026-06-29
- **决策者**: lc-cn（/grill-with-docs）

## 背景

外部 AI Agent（Cursor、Claude Desktop）需通过标准接口操作 IM：发消息、查群、收消息。MCP（Model Context Protocol）作为 OneBots 第五条输出协议，与 OneBot/Satori/Milky 并列。

**前置条件（2026-06-29 修订）**：网关 P0（消息/ID/segment 正确性 + 连接稳定）达标后再实施；否则 MCP Tools 会放大底层映射错误。

## 决策

### 使用场景

**外部 Agent 连 OneBots** — Agent 通过 MCP 调用 IM 能力；OneBots 不提供 Agent 推理大脑。

### 包结构

```
protocols/mcp-v1/
  protocol/   # @onebots/protocol-mcp-v1 — Protocol 实现 + MCP server
  sdk/        # @onebots/sdk-mcp-v1 — 外部 Node 集成（与 OneBot SDK 惯例一致）
```

注册：`ProtocolRegistry.register('mcp', 'v1', McpV1Protocol)`

### 传输

| 模式 | 说明 |
|------|------|
| **HTTP/SSE** | 网关路径 `/{platform}/{account_id}/mcp/v1`，与 OneBot WS 路径模型一致 |
| **stdio** | CLI `onebots mcp [--config config.yaml] [--account platform/account_id]`，供本地 Cursor spawn |

### 配置

与 OneBot 同级，在 `config.yaml`：

```yaml
general:
  mcp.v1:
    access_token: ''   # 可选默认

accounts:
  - platform: kook
    account_id: mybot
    protocols:
      mcp.v1:
        use_http_sse: true
        access_token: ''  # 覆盖 general
```

### 多账号

**每 Account 独立 MCP Server** — 不共用全局 endpoint；Cursor 配置多个 MCP server 连接不同账号。

### 鉴权

**复用 `access_token`** — HTTP/SSE 使用 Bearer 或 query 参数，与 OneBot 一致。

### Tools（v1 Agent 标准包，12 个）

| Tool | 映射 Adapter API |
|------|------------------|
| `send_message` | `sendMessage` |
| `delete_message` | `deleteMessage` |
| `get_message` | `getMessage` |
| `get_login_info` | `getLoginInfo` |
| `get_user_info` | `getUserInfo` |
| `get_friend_list` | `getFriendList` |
| `get_group_list` | `getGroupList` |
| `get_group_info` | `getGroupInfo` |
| `get_group_member_list` | `getGroupMemberList` |
| `get_channel_list` | `getChannelList` |
| `get_supported_actions` | `getSupportedActions` |

**v2（Q4）** 扩展：文件上传、禁言、群管理等高级 Tools，按平台实现度逐步开放。

未实现的平台 API 应通过 Tool 错误明确返回，而非 silent no-op。

### 入站消息

**SSE Notification** — Adapter 产生的 `CommonEvent`（message 等）转为 MCP server notification 推送给已连接 Agent。

### 与 Protocol 基类映射

| Protocol 方法 | MCP 实现 |
|---------------|----------|
| `start()` | 启动 HTTP/SSE endpoint 或 stdio transport |
| `stop()` | 关闭 transport、清理 subscription |
| `dispatch(event)` | 转为 MCP notification |
| `apply(action, params)` | 映射为对应 MCP Tool 调用（内部走 Adapter） |
| `format()` | 将 CommonEvent 格式化为 MCP notification payload |

### 验证矩阵（v1 MVP）

必须在以下平台验证 Tools + SSE 入站：

- **KOOK**
- **wechat-clawbot**

其他平台 best-effort。

## 后果

- Q3 交付 `@onebots/protocol-mcp-v1` + `@onebots/sdk-mcp-v1`
- 文档需提供 Cursor `mcp.json` 配置示例（HTTP 与 stdio 各一）
- `packages/core` Protocol 抽象足够复用，无需为 MCP 单独改 core（除非 transport 层需 Router 扩展）

## 相关

- [ADR-0002 协议战略](0002-protocol-strategy.md)
- [ADR-0003 2026 里程碑](0003-yearly-milestones.md)
