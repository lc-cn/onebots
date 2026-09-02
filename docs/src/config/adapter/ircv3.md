# IRCv3 配置

## 安装

```bash
pnpm add @onebots/adapter-ircv3
onebots -r ircv3
```

IRC 没有统一的机器人应用后台。请向所用网络确认 server、TLS 端口、账号注册方式、SASL 机制和 channel 权限。生产环境应使用 TLS；主动明文连接不会发送 server password 或 SASL password。

## 主动 TCP/TLS

```yaml
ircv3.libera_bot:
  host: irc.libera.chat
  port: 6697
  tls: true
  nickname: onebots
  username: onebots
  realname: OneBots IRCv3
  sasl_mechanism: PLAIN
  sasl_username: ${IRC_ACCOUNT}
  sasl_password: ${IRC_PASSWORD}
  sasl_required: true
  channels:
    - name: "#onebots"
      auto_join: true
```

Web 表单中的频道、capability 和事件 command 都可以逐项增减，不需要手写 JSON。TLS、SASL 和 manual 专属字段会按选择动态显示，常用信息不会被重复的高级项淹没。

SASL EXTERNAL 使用客户端证书：

```yaml
ircv3.cert_bot:
  host: irc.example.net
  tls: true
  nickname: onebots
  sasl_mechanism: EXTERNAL
  sasl_required: true
  tls_client_cert_path: /run/secrets/irc-client.crt
  tls_client_key_path: /run/secrets/irc-client.key
```

certificate 与 private key 必须成对配置。`tls_reject_unauthorized: false` 会关闭服务器身份校验，只应用于受控测试网络。

## 已有连接或手动入口

```yaml
ircv3.embedded:
  nickname: onebots
  receive_mode: manual
  event_commands:
    - PRIVMSG
    - NOTICE
    - JOIN
    - PART
```

```ts
import { Ircv3Client } from "@onebots/adapter-ircv3";

const client = new Ircv3Client(config);
await client.start(signal);
await client.acceptSocket(socket, { owned: false }, signal);
await client.ingest(rawMessage);
```

`acceptSocket()` 可接收宿主已有 TCP/TLS 连接或 WebSocket bridge。默认 `owned: false`，停止 Client 只解绑；若 socket 已完成 IRC 注册，传入 `registered: true` 以及已协商 capabilities/ISUPPORT，避免重复 CAP/NICK/USER。`ingest()` 不创建网络端口，适合反向连接、队列和测试夹具。

## 关键字段

| 字段 | 必填 | 说明 |
|---|---:|---|
| `account_id` | 由账号键提供 | OneBots 内稳定账号标识 |
| `receive_mode` | 否 | `connection`（默认）或 `manual` |
| `host` | 主动连接 | 纯主机名/IP，不含 scheme、端口或路径 |
| `port` | 否 | TLS 默认 6697，明文默认 6667 |
| `nickname` | 是 | 初始 IRC nickname |
| `channels` | 否 | 可动态增减的自动 JOIN 记录列表 |
| `requested_capabilities` | 否 | 默认稳定 IRCv3 集合，可显式加入 vendor capability |
| `event_commands` | 否 | 会产生业务事件的 command 过滤器 |
| `sasl_mechanism` | 否 | `PLAIN` 或 `EXTERNAL` |
| `reconnect_*_delay_ms` | 否 | 无限重连的初始/最大退避；带 jitter |
| `max_line_bytes` | 否 | 有界入站帧；主报文仍单独限制为 512 bytes |

PING、CAP、AUTHENTICATE 与 numeric 会继续维护会话和请求关联，不受 `event_commands` 影响，但不会作为业务事件派发。历史规范仍为 WIP，必须在 capability 列表显式加入 `draft/chathistory`；只有它和 `batch`、`message-tags`、`server-time` 均成功协商且服务器宣告 CHATHISTORY ISUPPORT 时，历史动作才会显示为可用。

平台映射见 [IRCv3 平台说明](/platform/ircv3)。
