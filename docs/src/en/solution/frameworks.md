# Bot framework solutions

Bot frameworks are now OneBots **Applications**, a third runtime extension type alongside Adapters and Protocols. Startup follows:

```text
-r Adapter → -p Protocol → -t Application → create accounts/protocols → inject Application extensions
```

```bash
onebots -r mock -p onebot-v11 -t zhin
```

Applications compose protocol start/stop, actions, and event dispatch while publishing compatible actions, dedicated routes, connections, and limitations per protocol instance. `GET /api/applications` exposes registered and active Applications plus per-account protocol capabilities. External packages resolve as `@onebots/application-<name>`, `onebots-application-<name>`, or the literal package name.

## Support stages

- **available**: 14 frameworks/distributions can be activated with `-t`; Zhin has an independent npm Application and dedicated WebSocket.
- **planned**: 11 researched targets share the registry but activation is rejected until an implementation and pinned interoperability gate exist.

Use the Solutions menu for one page per framework with commands, protocols, transports, and limitations.
