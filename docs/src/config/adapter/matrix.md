# Matrix 配置

## 普通机器人（推荐）

```yaml
matrix.bot:
  homeserver_url: https://matrix.example.com
  user_id: "@onebots:example.com"
  access_token: your-access-token
  receive_mode: sync
  event_types:
    - m.room.message
    - m.sticker
    - m.reaction
    - m.room.redaction
    - m.room.member
    - m.room.name
    - m.room.topic
    - m.typing
    - m.receipt
    - m.presence
    - m.direct
  sync_timeout_ms: 30000
  sync_retry_min_ms: 1000
  sync_retry_max_ms: 60000
  lazy_load_members: true
  onebot.v12:
    access_token: downstream-token
```

启动时会调用 `whoami`，返回的 `user_id` 必须与配置完全一致。Web 表单中的事件类型使用可动态增减的选择列表，直接生成 `/sync` filter，不需要手写 JSON。

`whoami`、异步就绪监听器、`/sync` 长轮询和后续协议出口共用账号启动边界。达到全局 `timeout` 或取消热重载时，适配器会中止正在进行的身份与同步请求；连接代次检查会阻止忽略取消的迟到响应重新恢复账号状态。

## Application Service

```yaml
matrix.bridge:
  homeserver_url: https://matrix.example.com
  user_id: "@onebots:example.com"
  receive_mode: appservice
  appservice_id: onebots
  as_token: your-as-token
  hs_token: your-hs-token
  appservice_path: /matrix/bridge/appservice
```

对应 homeserver registration：

```yaml
id: onebots
url: https://gateway.example.com/matrix/bridge/appservice
as_token: your-as-token
hs_token: your-hs-token
sender_localpart: onebots
rate_limited: false
receive_ephemeral: true
namespaces:
  users: []
  aliases: []
  rooms: []
```

homeserver 会在 registration `url` 后调用标准 `/_matrix/app/v1/...` 路径。OneBots 不声明虚拟用户或房间 namespace；收到对应查询会返回标准 `M_NOT_FOUND`，不会凭空创建实体。需要拥有 namespace 的桥接器应实现自己的查询逻辑，并通过 `manual`/已有 Host 把 transaction 交给 `MatrixClient`。账号热重载时，同一路径会动态解析当前 Client，不会继续调用已停止的旧实例。

## Manual / 已有 Host

```yaml
matrix.embedded:
  homeserver_url: https://matrix.example.com
  user_id: "@onebots:example.com"
  access_token: your-access-token
  receive_mode: manual
```

```ts
import { MatrixClient } from "@onebots/adapter-matrix";

const client = new MatrixClient(config);
client.on("event", async envelope => {
    // 原始事件、room_id、section 与可靠投递状态都在同一个强类型入口中。
});

await client.ingest({ event: decryptedEvent, room_id, section: "manual" });

// AppService 使用已有 Fetch/WinterCG Host：
const response = await client.acceptHttp(request);
```

`manual` 不会启动 `/sync` 或挂载 OneBots 路由。`acceptHttp()` 仅接受当前标准 Bearer `hs_token`；不会为旧 query-only token 增加隐式兼容。

`upload_file` 只接收宿主已经读取的 base64 `data`（最大 100 MiB）。适配器不会自行读取本地路径或抓取远程 URL，避免把网关变成本地文件读取或 SSRF 出口。
