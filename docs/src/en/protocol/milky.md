# Milky v1 Protocol

Milky is an open QQ bot protocol. OneBots implements its `event_type` envelope, message scenes, and `/api/{action}` action namespace through the shared Adapter capability layer.

## Install and register

```bash
pnpm add @onebots/protocol-milky-v1
onebots -r icqq -p milky-v1 -c config.yaml
```

For the client SDK:

```bash
pnpm add imhelper @imhelper/milky-v1
```

## Configure

```yaml
general:
  milky.v1:
    use_http: true
    use_ws: true
    access_token: your-token
```

## Transport endpoints

| Purpose | Endpoint |
| --- | --- |
| HTTP API | `POST /{platform}/{account_id}/milky/v1/api/{action}` |
| Forward WebSocket | `GET /{platform}/{account_id}/milky/v1/event` |

HTTP actions require `application/json`. Supply the token through `Authorization: Bearer <token>` or the `access_token` query parameter.

```bash
curl -X POST http://localhost:6727/icqq/10001/milky/v1/api/send_private_message \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your-token' \
  -d '{
    "user_id": 123456789,
    "message": [{ "type": "text", "data": { "text": "Hello" } }]
  }'
```

WebSocket action requests use `{ action, params, echo? }`; responses preserve `echo`.

## Event model

```json
{
  "time": 1788080000,
  "self_id": 10001,
  "event_type": "message_receive",
  "data": {
    "message_scene": "group",
    "peer_id": 987654321,
    "message_seq": 42,
    "sender_id": 123456789,
    "time": 1788080000,
    "segments": [{ "type": "text", "data": { "text": "Hello" } }]
  }
}
```

Messages use `event_type: "message_receive"`; `data.message_scene` is `friend`, `group`, or `temp`. Request events include `friend_request`, `group_join_request`, and `group_invited_join_request`. Milky events are never rewritten into OneBot `post_type/message_type` shapes.

## Client SDK

```typescript
import { createMilkyClient } from '@imhelper/milky-v1';

const client = createMilkyClient({
  baseUrl: 'http://localhost:6727/icqq/10001/milky/v1',
  selfId: '10001',
  accessToken: 'your-token',
  receiveMode: 'ws',
});

client.on('message.group', async message => message.reply('Received!'));
await client.start();
```

The SDK derives `/event` from `baseUrl` and sends actions through `/api/{action}`. Use `receiveMode: 'manual'` with `ingest()`, `acceptHttp()`, and `acceptWebSocket()` when the host already owns the transport.

## Links

- [Official Milky specification](https://milky.ntqqrev.org/)
- [Milky configuration](/en/config/protocol/milky-v1)
- [Client SDK guide](/en/guide/client-sdk)
