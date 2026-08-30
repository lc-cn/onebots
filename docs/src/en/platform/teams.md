# Microsoft Teams Adapter

`@onebots/adapter-teams` uses Microsoft 365 Agents SDK 1.8.1, Teams API 2.0.15, the Connector API, and Microsoft Graph. It does not depend on the legacy Bot Framework SDK or open a second HTTP server.

## Configuration

```yaml
teams.work-agent:
  account_id: work-agent
  app_id: "Microsoft Entra Client ID"
  app_password: "Client Secret Value"
  tenant_id: "Tenant ID"
  receive_mode: webhook # webhook or manual
```

Webhook mode mounts `/teams/{account_id}/webhook` by default. Configure the Azure Bot Messaging endpoint with its public HTTPS URL, for example `https://bot.example/teams/work-agent/webhook`, and preserve the `Authorization` header and JSON body through the reverse proxy.

Manual mode registers no route. Existing hosts can call `ingestHttp({ method, headers, body })` for a structured response, `acceptHttp(request)` in Fetch/WinterCG hosts, or `acceptHttp(ctx)` in Koa hosts. All entry points share JWT validation, ConversationReference storage, and reliable event delivery.

## Native Capabilities

Teams proactive messages require a complete ConversationReference rather than only a conversation ID. The adapter persists the service URL, tenant, participants, and conversation hierarchy, and refuses to invent missing context.

- Private chats, group chats, and team channels retain distinct scene semantics.
- Text, mentions, threaded replies, quoted replies, HTTPS media, Adaptive Cards, Bot Cards, suggested actions, and raw Activities are supported.
- `teams_quote` round-trips the official `quotedReply` entity and can reference multiple historical messages without conflating it with `replyToId`.
- Message lifecycle, reactions, targeted messages, meeting context, member rosters, file-consent uploads, and Azure Bot OAuth have named actions.
- `call_graph_api` exposes a constrained relative-path Graph entry point; app-only permissions are not used to impersonate users for ordinary chat sends.

The `teams_activity` segment preserves AI labels, citations, sensitivity, feedback controls, stream metadata, delivery options, and suggested actions. Media links must be publicly reachable through HTTPS. Personal-chat uploads use file consent; channel and group-chat files require Graph and SharePoint/OneDrive permissions.

## Events

Messages, updates, deletions, membership changes, and reactions map to canonical events. A personal-chat `application/vnd.microsoft.readReceipt` maps to `message_status`; both `message_id` and `extensions.teams.last_read_message_id` identify the last message read by the user. Enable the `ChatMessageReadReceipt.Read.Chat` RSC permission in the Teams app manifest. Delivery also depends on the tenant and user's read-receipt settings.

Invokes map to `interaction`; group installation lifecycle maps to `group_increase/group_decrease`; typing, meetings, and unmapped Activities remain lossless `custom` notices. The original Agents SDK Activity is always available at `raw_event.raw_activity`.

## Links

- [Microsoft 365 Agents SDK](https://learn.microsoft.com/microsoft-365/agents-sdk/)
- [Quoted replies and read receipts](https://learn.microsoft.com/microsoftteams/platform/bots/build-conversational-capability)
- [Teams files](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/bots-filesv4)
- [Client SDK Guide](/en/guide/client-sdk)
