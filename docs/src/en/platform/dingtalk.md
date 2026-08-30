# DingTalk Adapter

`@onebots/adapter-dingtalk` targets DingTalk enterprise bots. It receives events through Stream, HTTP callbacks, or an existing host, and sends through the enterprise Robot OpenAPI, session webhooks, or a custom group robot.

## Installation

```bash
pnpm add @onebots/adapter-dingtalk
```

## Stream mode

```yaml
dingtalk.my_bot:
  account_id: my_bot
  receive_mode: stream
  app_key: dingxxxxxxxx
  app_secret: xxxxxxxx
  robot_code: dingxxxxxxxx # optional; defaults to app_key
  agent_id: "123456" # only required by work notifications
```

Add and publish the bot capability in the DingTalk developer console. Stream mode needs no public callback URL. OneBots acknowledges an event only after every protocol destination has attempted delivery; failed events remain eligible for DingTalk redelivery.

## HTTP callbacks and existing hosts

```yaml
dingtalk.my_bot:
  account_id: my_bot
  receive_mode: webhook
  app_key: dingxxxxxxxx
  app_secret: xxxxxxxx
  corp_id: dingxxxxxxxx
  token: callback-token
  encrypt_key: 43-character-EncodingAESKey
```

The OneBots-managed callback is `POST /dingtalk/{account_id}/webhook`. The adapter verifies signatures, decrypts AES payloads, validates the CorpId, and produces the encrypted response required by DingTalk.

Use `receive_mode: manual` when another HTTP host, queue, or connection owns ingress:

- pass an already verified payload to `await bot.ingest(rawEvent)`;
- use `ingestHttp({ method, query, body })` from a Node host;
- use `await bot.acceptHttp(request)` from a Fetch/WinterCG host;
- use `await bot.acceptHttp(ctx)` from Koa.

All entry points share signature validation, deduplication, concurrency control, and event projection. The SDK does not open another port.

## Messages and media resources

Inbound messages support text, rich text, images, audio, video, and files. Outbound messages support text, Markdown, image URLs, links, and ActionCard. Every inbound media segment exposes the DingTalk download code as `file`, `resource_id`, and `download_code`.

Pass `resource_id` to the canonical `get_resource_temp_url` action. The adapter exchanges it through `/v1.0/robot/messageFiles/download` and returns a temporary HTTPS URL. The named `get_robot_message_file_download_url` platform action exposes the same operation with `downloadCode` and an optional event-specific `robotCode`.

## Platform capabilities

The adapter also covers enterprise robot delivery, recall and read status, work notifications, users/departments/roles, scene groups and membership, and interactive-card creation, delivery, updates, and AI streaming. See the [package README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-dingtalk) for the complete named-action contract.

`call_dingtalk_api` is a constrained low-level escape hatch. It accepts only absolute OpenAPI paths without traversal or embedded URL query semantics; prefer named actions for stable capabilities.

## Related links

- [Client SDK Guide](/en/guide/client-sdk)
- [DingTalk Open Platform](https://open.dingtalk.com/)
- [DingTalk Stream Node.js SDK](https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs)
