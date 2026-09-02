# @onebots/adapter-ircv3

Modern IRC and stable IRCv3 adapter for OneBots. One typed `Ircv3Client` owns protocol state while managed TCP/TLS, a host-owned socket, and `ingest(rawEvent)` all use the same strict codec and event pipeline.

## 特性

- 主动 TCP/TLS、已有 `net.Socket` / `tls.TLSSocket` / WebSocket bridge，以及纯手动事件入口；
- CAP 302 多行协商、`cap-notify`、SASL PLAIN/EXTERNAL、ISUPPORT 与自动 JOIN；
- 默认无限指数退避重连、jitter、`AbortSignal` 和连接 generation 隔离；
- message-tags、server-time、batch、labeled-response、echo-message、account/away/chghost/setname 等稳定扩展；
- `draft/chathistory`、`CHATHISTORY`、`MONITOR`、`CLIENTTAGDENY` 按实际 CAP/ISUPPORT 动态收敛能力；
- PRIVMSG、NOTICE、CTCP ACTION、reply、typing、成员、邀请、MODE、TOPIC 与用户状态 canonical 投影；
- WHOIS、NAMES、JOIN/PART、NOTICE/ACTION、MODE、KICK、INVITE、TOPIC、AWAY、SETNAME、MONITOR、CHATHISTORY 等平台动作；
- 严格 CRLF 分帧、独立 tag/main section 字节上限、控制字符拦截与结构化 `Ircv3Error`。

## Managed connection

```ts
import { Ircv3Client } from "@onebots/adapter-ircv3";

const client = new Ircv3Client({
  account_id: "libera-bot",
  host: "irc.libera.chat",
  port: 6697,
  tls: true,
  nickname: "onebots",
  sasl_mechanism: "PLAIN",
  sasl_username: process.env.IRC_ACCOUNT!,
  sasl_password: process.env.IRC_PASSWORD!,
  sasl_required: true,
  channels: [{ name: "#onebots" }],
});

client.on("event", delivery => dispatch(delivery));
await client.start(signal);
```

## Existing socket or manual ingress

```ts
const client = new Ircv3Client({
  account_id: "embedded",
  nickname: "onebots",
  receive_mode: "manual",
});

await client.start(signal);

// 未注册连接：Client 执行 CAP/NICK/USER/SASL；owned: false 时不关闭宿主连接。
await client.acceptSocket(socket, { owned: false }, signal);

// 已由宿主完成注册：显式交付协商结果，Client 不重复注册。
await client.acceptSocket(upgradedSocket, {
  owned: false,
  registered: true,
  nickname: "onebots",
  enabledCapabilities: { "message-tags": null, "server-time": null },
  isupport: { CASEMAPPING: "rfc1459", CHANTYPES: "#&" },
});

// 队列、反向连接或测试夹具的最低层入口。
await client.ingest("@time=2026-09-02T00:00:00.000Z :alice!u@h PRIVMSG #onebots :hello");
```

`acceptSocket()` 接收最小 `Ircv3Socket` 接口，因此 WebSocket 必须由宿主桥接为文本 IRC message 帧；它不是 WebSocket URL 客户端。`ingest()` 接受一条文本行、UTF-8 bytes 或已解析 message，仍执行状态更新、请求关联、过滤与 canonical 投影。

`call()` 适合嵌入式 SDK 用户；网关公开的 `call_irc_command` 只允许无凭据、无连接生命周期副作用的命令。需要收集 numeric 回复时使用 `request()`，在支持 labeled-response 的网络并发执行，否则自动串行。

默认只请求 IRCv3 稳定 capabilities。历史查询要求用户显式加入 WIP `draft/chathistory`，并成功协商其依赖与 `CHATHISTORY` ISUPPORT；`draft/multiline` 不会被包装成稳定的多段消息能力。其他自定义 capability 也可显式配置，但未知语义只保留在 raw message 中。

See the [Chinese configuration guide](../../docs/src/config/adapter/ircv3.md), [English configuration guide](../../docs/src/en/config/adapter/ircv3.md), and official [IRCv3 specifications](https://ircv3.net/irc/), [CAP negotiation](https://ircv3.net/specs/extensions/capability-negotiation.html), [SASL](https://ircv3.net/specs/extensions/sasl-3.2), and [Modern IRC](https://modern.ircdocs.horse/).
