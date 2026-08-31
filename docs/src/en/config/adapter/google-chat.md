# Google Chat configuration

Install and load the adapter:

```bash
pnpm add @onebots/adapter-google-chat
onebots -r google-chat
```

The Web console renders credentials and receive mode as selectors, scopes and event types as add/remove choice lists, and private keys/tokens as sensitive fields. No JSON editing is required.

## API identity

For a Chat app, bind a service account in Google Cloud and use `service-account`. The default scope is `chat.bot`; app-wide message, Space, or membership scopes can require Workspace administrator approval.

```yaml
google-chat.chat_app:
  auth_mode: service-account
  service_account_email: bot@project.iam.gserviceaccount.com
  service_account_private_key: |
    -----BEGIN PRIVATE KEY-----
    ...
    -----END PRIVATE KEY-----
  principal_name: users/app
```

For an existing user OAuth flow, choose `access-token`, set `principal_name: users/me`, and list the scopes granted to the token. The external OAuth service remains responsible for refreshing a static token.

Leaving as the app requires `chat.memberships.app`. For canonical `leave_group` under user authentication, configure `principal_name` as `users/{id|email}`: the `users/me` alias works for many user APIs but cannot uniquely match a membership resource.

## Interaction HTTPS

```yaml
google-chat.chat_app:
  receive_mode: interaction-http
  http_path: /google-chat/chat_app/events
  verification_mode: endpoint-url
  verification_audience: https://bots.example.com/google-chat/chat_app/events
```

Point the Chat API Configuration HTTP endpoint at the same public HTTPS URL. `endpoint-url` verifies Google's OIDC ID token; `project-number` verifies the official Chat self-signed JWT. OneBots mounts the path on its existing HTTP host and resolves the current client after hot reload.

## Workspace Events and Pub/Sub push

```yaml
google-chat.audit:
  receive_mode: pubsub-push
  http_path: /google-chat/audit/events
  verification_audience: https://bots.example.com/google-chat/audit/events
  pubsub_service_account_email: push-auth@project.iam.gserviceaccount.com
  event_types:
    - google.workspace.chat.message.v1.created
    - google.workspace.chat.reaction.v1.created
```

Enable authenticated push on the subscription. The adapter verifies audience, `email_verified`, and the exact service-account email, expands Google-generated batch events, and returns a non-2xx response when downstream delivery fails.

## Existing host or connection

Use `receive_mode: manual` and call `ingest(rawEvent)`. A Fetch host can use `acceptHttp(Request)` in either HTTP mode, while framework hosts use structured `ingestHttp()`. Manual mode deliberately rejects HTTP because it has no configured inbound verification contract.

`call()` accepts only relative API paths, uploads accept host-materialized base64 only, and `downloadMedia()` returns raw `Uint8Array` bytes. Acknowledgements happen only after strict validation and every asynchronous listener succeeds.

Official references: [REST v1](https://developers.google.com/workspace/chat/api/reference/rest), [verify interaction requests](https://developers.google.com/workspace/chat/verify-requests-from-chat), and [Chat event subscriptions](https://developers.google.com/workspace/events/guides/events-chat).
