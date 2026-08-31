# @onebots/adapter-matrix

Matrix Client-Server API and Application Service adapter for OneBots.

实现基线为当前稳定 Matrix v1.19。

## 特性

- 可嵌入 `MatrixClient`，支持 `sync`、`appservice`、`manual` 三种接收方式；
- `ingest(rawEvent)`、结构化 `ingestHttp()` 与 Fetch `acceptHttp(Request)` 共用可靠事件管线；
- 标准 AppService transaction/ping、Bearer `hs_token`、txnId 幂等与失败重投；
- 房间、成员 power level、消息、编辑、redaction、reaction、回执、Typing、Presence、State、媒体与通用相对路径调用；
- 严格校验外部 JSON、结构化 Matrix 错误、无限可取消 `/sync` 重试；
- `m.room.encrypted` 保留密文，不虚报 E2EE 解密。

## Standalone client

```ts
import { MatrixClient } from "@onebots/adapter-matrix";

const client = new MatrixClient({
  account_id: "bot",
  homeserver_url: "https://matrix.example.com",
  user_id: "@bot:example.com",
  access_token: process.env.MATRIX_ACCESS_TOKEN,
  receive_mode: "manual",
});

client.on("event", async envelope => {
  await handleMatrixEvent(envelope);
});

await client.start();
await client.ingest(rawEvent);
```

## English

The package exports a fully typed standalone client. `/sync`, AppService HTTP transactions and manual events converge on one ordered, deduplicated pipeline. Use `call(method, relativePath, options)` for current official endpoints that do not yet have a domain helper; absolute URLs are rejected so credentials cannot escape the configured homeserver.

See the [Chinese platform guide](../../docs/src/platform/matrix.md) or [English platform guide](../../docs/src/en/platform/matrix.md).
