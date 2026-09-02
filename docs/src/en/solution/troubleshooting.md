# Framework troubleshooting

```bash
onebots doctor -c config.yaml
onebots frameworks --framework <framework> --account <platform.account_id>
```

Verify loaded plugins, the `platform.account_id` key, generated endpoint, and identical tokens.

- Forward WebSocket requires explicit `use_ws: true`.
- Start a reverse WebSocket framework listener before OneBots.
- Use a Compose service name instead of `127.0.0.1` between containers.
- 404 points to a path error; 401 means token mismatch.
- For `Unknown action`, inspect required/missing actions and Adapter capabilities. Change Adapter, disable the dependent plugin, or implement a verified Application conversion.
- If connected without events, check account login, platform subscriptions, callback permissions, and filters.

Include versions, redacted configuration, doctor conclusions, endpoint/direction, status code, failing action, and logs in bug reports. Never publish tokens.
