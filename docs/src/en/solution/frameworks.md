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

- **available**: 14 frameworks or distributions with pinned configuration or interoperability evidence can be activated with `-t`; Zhin has an independent npm Application and dedicated WebSocket.
- **experimental**: 9 frameworks, SDKs, bridges, or distributions with a documented protocol surface are activatable and expose connection templates plus runtime compatibility actions. They remain experimental until pinned interoperability passes.
- **legacy**: PepperBot and NoneBot 1 are activatable for existing migrations. The management API preserves their legacy status and they are not recommended for new deployments.

Both `experimental` and `legacy` are runnable stages. Each matching protocol gains a unique `get_<framework>_application_info` action; unmatched protocols report an explicit `unsupported` capability.

Use the Solutions menu for one page per framework with commands, protocols, transports, and limitations.
