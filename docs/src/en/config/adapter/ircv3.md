# IRCv3 Configuration

## Installation

```bash
pnpm add @onebots/adapter-ircv3
onebots -r ircv3
```

IRC has no universal bot console. Obtain the server, TLS port, account registration method, SASL mechanism, and channel permissions from your network. Production connections should use TLS; a managed plaintext connection will not send a server or SASL password.

## Managed TCP/TLS

```yaml
ircv3.libera_bot:
  host: irc.libera.chat
  port: 6697
  tls: true
  nickname: onebots
  sasl_mechanism: PLAIN
  sasl_username: ${IRC_ACCOUNT}
  sasl_password: ${IRC_PASSWORD}
  sasl_required: true
  channels:
    - name: "#onebots"
      auto_join: true
```

Channels, capabilities, and event commands are structured lists in the Web form. TLS, SASL, and manual-only fields appear only when relevant.

SASL EXTERNAL uses a TLS client certificate:

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

The certificate and private key must be configured together. Disabling `tls_reject_unauthorized` removes server identity verification and is only suitable for controlled test networks.

## Existing connection or manual ingress

```yaml
ircv3.embedded:
  nickname: onebots
  receive_mode: manual
  event_commands: [PRIVMSG, NOTICE, JOIN, PART]
```

```ts
import { Ircv3Client } from "@onebots/adapter-ircv3";

const client = new Ircv3Client(config);
await client.start(signal);
await client.acceptSocket(socket, { owned: false }, signal);
await client.ingest(rawMessage);
```

`acceptSocket()` accepts a host-owned TCP/TLS connection or WebSocket bridge. With `owned: false`, stopping the client only detaches listeners. For an already registered socket, pass `registered: true` and its negotiated capabilities/ISUPPORT so the client does not repeat CAP/NICK/USER. `ingest()` opens no listener and is suitable for reverse connections, queues, and test fixtures.

## Important fields

| Field | Required | Meaning |
|---|---:|---|
| `receive_mode` | No | `connection` (default) or `manual` |
| `host` | Managed mode | Hostname/IP without a scheme, port, or path |
| `port` | No | 6697 with TLS, otherwise 6667 |
| `nickname` | Yes | Initial IRC nickname |
| `channels` | No | Dynamic auto-JOIN record list |
| `requested_capabilities` | No | Stable IRCv3 defaults plus explicit vendor capabilities |
| `event_commands` | No | Commands that may produce business events |
| `sasl_mechanism` | No | `PLAIN` or `EXTERNAL` |
| `reconnect_*_delay_ms` | No | Initial/maximum jittered delay; retries are unlimited |
| `max_line_bytes` | No | Bounded input frame; the main section remains independently capped at 512 bytes |

PING, CAP, AUTHENTICATE, and numerics still maintain session/request state regardless of `event_commands`, but are not emitted as business events. History remains a work-in-progress specification: add `draft/chathistory` explicitly, and the action becomes available only when it plus `batch`, `message-tags`, and `server-time` are negotiated and CHATHISTORY ISUPPORT is advertised.

See [IRCv3 Platform](/en/platform/ircv3).
