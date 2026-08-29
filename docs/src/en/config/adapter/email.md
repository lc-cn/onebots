# Email Adapter Configuration

The Web console groups these fields into credentials, transport, delivery, filtering, and advanced sections. Only snake_case fields are accepted; SMTP and IMAP no longer duplicate authentication or proxy settings.

## Identity and authentication

| Field | Required | Description |
| --- | --- | --- |
| `address` | yes | Public sender address |
| `display_name` | no | Sender display name |
| `default_subject` | no | Used when a message has no subject |
| `auth.user` | yes | Shared SMTP and IMAP username |
| `auth.password` | one of | Password, authorization code, or app password |
| `auth.access_token` | one of | OAuth2 access token; preferred when configured |

## SMTP and IMAP

`smtp.host` and `imap.host` are required. SMTP defaults to STARTTLS and IMAP defaults to direct TLS. Omitted ports resolve to 465/587 for SMTP and 993/143 for IMAP according to the security mode.

IMAP IDLE provides real-time delivery. `poll_interval_ms` is a fallback check and defaults to 60000; set it to 0 to disable only that fallback. Reconnection uses an unlimited exponential backoff bounded by `retry_initial_delay_ms` and `retry_max_delay_ms`.

TLS certificates are verified by default. Disable `reject_unauthorized` only for a controlled, self-signed server.

## Shared proxy

The top-level proxy applies to both transports and supports HTTP, HTTPS, SOCKS4, and SOCKS5:

```yaml
proxy:
  url: socks5://127.0.0.1:1080
  username: optional-user
  password: optional-password
```

Gmail commonly requires an app password or OAuth2. QQ Mail commonly requires an IMAP/SMTP authorization code.
