# WhatsApp Adapter Configuration

The adapter connects directly to Meta WhatsApp Cloud API and mounts its webhook on the existing OneBots HTTP host.

Subscribe `messages` for normal delivery. Eligible Groups API accounts must additionally subscribe the v23 fields `group_lifecycle_update`, `group_participant_update`, and `group_settings_update`; all fields share the same webhook path and client delivery pipeline.

```yaml
whatsapp.my_bot:
  phone_number_id: "your_phone_number_id"
  business_account_id: "your_business_account_id"
  access_token: "your_long_lived_access_token"
  app_secret: "your_meta_app_secret"
  webhook_verify_token: "your_random_verify_token"
  api_version: "v23.0"

  onebot.v11:
    access_token: "your_onebots_token"
```

| Field | Required | Description |
| --- | --- | --- |
| `phone_number_id` | Yes | Phone Number ID from WhatsApp API Setup |
| `business_account_id` | Yes | WABA ID used by template-management APIs |
| `access_token` | Yes | Prefer a long-lived system-user token |
| `app_secret` | Yes | Meta App Secret used for `X-Hub-Signature-256` validation |
| `webhook_verify_token` | Yes | Random value that must match the Meta webhook setting |
| `webhook_path` | No | Defaults to `/whatsapp/{account_id}/webhook` |
| `api_version` | Yes | Graph API version, for example `v23.0`; use the version enabled for the app |
| `api_base_url` | No | Override only for compatible gateways or tests |
| `deduplicate_webhooks` | No | Filters Meta redeliveries; enabled by default |
| `webhook_deduplication_limit` | No | In-process deduplication limit; defaults to 10000 |

Configure the public callback URL in Meta, use the same verify token, subscribe to `messages`, and preserve both the raw request body and `X-Hub-Signature-256` through your reverse proxy.

Legacy camelCase fields, `webhook.url`, `webhook.fields`, and adapter-specific proxy settings have been removed so configuration has one canonical source.

## Startup Timeout and Cancellation

WhatsApp account startup verifies the phone identity behind `phone_number_id` through the Graph API and observes the global OneBots `timeout`. A timeout or configuration-reload cancellation aborts the in-flight Graph request, while lifecycle generations prevent a transport that ignores cancellation from restoring online state with a late result. The signal remains active until protocol outlets finish, so a failed outlet startup also stops the account during rollback.

See [WhatsApp platform](/en/platform/whatsapp) for native actions and message coverage.
