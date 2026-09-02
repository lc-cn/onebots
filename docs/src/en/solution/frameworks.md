# Framework matrix

```bash
onebots frameworks --framework <framework> --account <platform.account_id>
```

Koishi and Avilla use Satori v1, Karin uses Milky v1, Walle uses OneBot v12, and the remaining integrations use OneBot v11. Each framework page records the connection direction.

- `actions`: actions actually added or converted by the Application;
- `requiredActions`: actions called by the framework;
- `unsupportedActions`: missing actions confirmed by the pinned audit.

Applications never enable transports. Standard actions belong to Protocols; platform-private actions depend on Adapter capabilities.
