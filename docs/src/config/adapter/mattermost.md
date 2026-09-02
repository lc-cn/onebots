# Mattermost 配置

## 安装

```bash
pnpm add @onebots/adapter-mattermost
onebots -r mattermost
```

创建 Mattermost Bot Account 或专用用户，签发 Access Token，并按实际动作授予最小权限。Token 会作为 `Authorization: Bearer` 发送，不会写入 URL。

## 主动可靠 WebSocket

```yaml
mattermost.support:
  server_url: https://mattermost.example.com
  access_token: ${MATTERMOST_TOKEN}
  receive_mode: websocket
  event_types:
    - posted
    - post_edited
    - post_deleted
    - reaction_added
    - reaction_removed
    - typing
  team_ids:
    - teamid123
  channel_ids: []
  reconnect_initial_delay_ms: 1000
  reconnect_max_delay_ms: 30000
  connect_timeout_ms: 15000
```

`server_url` 是实例根地址，也支持 Mattermost 部署子路径。生产必须使用 HTTPS，本机测试可使用 localhost HTTP。`event_types`、`team_ids` 和 `channel_ids` 在 Web 中都是可动态增减的 choice-list；空资源过滤器表示全部，不需要手写 JSON。

## 已有 Host / 连接管理器

```yaml
mattermost.embedded:
  server_url: https://mattermost.example.com
  access_token: ${MATTERMOST_TOKEN}
  receive_mode: manual
```

```ts
import { MattermostClient } from "@onebots/adapter-mattermost";

const client = new MattermostClient({
  account_id: "embedded",
  server_url: "https://mattermost.example.com",
  access_token: process.env.MATTERMOST_TOKEN!,
  receive_mode: "manual",
});

await client.start(signal);
client.on("event", delivery => dispatch(delivery));

await client.acceptSocket(existingSocket, {
  authenticate: false, // 仅当宿主已用连接头完成认证
  owned: false,        // stop() 不关闭宿主 socket
}, signal);

await client.ingest(decodedMattermostWebSocketEvent);
```

`acceptSocket()` 接收已建立或正在建立的 `ws.WebSocket`。默认仍发送官方 `authentication_challenge`；若宿主已认证才关闭它。`ingest()` 只接受官方 event envelope，不接受 action response，并与主动连接共用严格校验、过滤、可靠去重和 canonical 投影。

## 字段说明

| 字段 | 必填 | 说明 |
|---|---:|---|
| `server_url` | 是 | Mattermost 实例根 URL；允许部署子路径 |
| `access_token` | 是 | Bot Account Token 或 Personal Access Token，敏感字段 |
| `receive_mode` | 否 | `websocket`（默认）或 `manual` |
| `event_types` | 否 | WebSocket event 白名单；允许插件自定义事件名 |
| `team_ids` | 否 | 仅投递指定 Team 的可归属事件 |
| `channel_ids` | 否 | 仅投递指定 Channel 的可归属事件 |
| `reconnect_initial_delay_ms` | 否 | 无限重连的指数退避起点 |
| `reconnect_max_delay_ms` | 否 | 指数退避上限 |
| `connect_timeout_ms` | 否 | 握手和 WebSocket action 超时 |
| `max_response_bytes` | 否 | REST 响应内存上限 |

低层 `client.call(method, path, options)` 与 `call_mattermost_api` 只接受 `/api/v4` 内的相对路径；绝对 URL、查询串拼接、控制字符、普通或百分号编码的越界段都会在发请求前失败。管理、Bot、Team/Channel 成员动作需要对应 permission，Scheduled Posts 还依赖服务器功能和许可证。

平台行为见 [Mattermost 平台说明](/platform/mattermost)。
