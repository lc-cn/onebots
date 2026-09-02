# Bot framework solutions

OneBots now has three independent extension directions:

- an **Adapter** connects an IM platform and produces normalized events;
- a **Protocol** publishes those capabilities as OneBot, Satori, or Milky;
- a **Framework Integration Provider** describes how a downstream framework connects, authenticates, configures, and verifies that protocol.

Zhin, NoneBot, and Koishi remain protocol clients rather than platform adapters. A Provider produces endpoints, configuration for both sides, limitations, and pinned-version evidence. The catalog stays visible before any bot account is configured.

## Available solutions

`handshake` means a pinned version passed wrong-token rejection, connection, a private-message event, and identity and send actions. It does not claim full group-message, media, reconnect, or action coverage.

| Downstream | Protocol and transport | Pinned versions | Result |
| --- | --- | --- | --- |
| Koishi | Satori forward WebSocket | 4.18.6 / adapter 1.5.1 | `handshake` |
| NoneBot2 | OneBot 11 reverse WebSocket | 2.5.0 / adapter 2.4.6 | `handshake` |
| Karin | Milky WebSocket | 1.15.3 / adapter 1.3.3 | `handshake` |
| Zhin | OneBot 11 forward WebSocket | 6.0.15 / adapter 7.0.8 | `handshake`; first standalone built-in Provider |
| AlemonJS | OneBot 11 forward WebSocket | 2.1.103 / adapter 2.1.21 | `handshake` |
| melobot | OneBot 11 forward WebSocket | 3.4.0 / built-in adapter | `handshake` |
| ZeroBot | OneBot 11 forward WebSocket | 1.8.2 / built-in driver | `handshake` |
| Kovi | OneBot 11 split WebSocket | 0.13.0 / kovi-onebot 0.13.2 | `handshake`; `/api`, `/event`, and upstream double-slash paths supported |
| AstrBot | OneBot 11 reverse WebSocket | 4.28.0b1 / aiocqhttp 1.4.4 | `handshake` |
| LangBot | OneBot 11 reverse WebSocket | 4.10.9 / built-in adapter | `handshake` |
| AliceBot | OneBot 11 reverse WebSocket | 0.11.0 / CQHTTP adapter 0.11.0 | `handshake`; Provider repairs upstream handshake authentication |
| Kotori | OneBot 11 reverse WebSocket | 1.7.5 / adapter 2.1.2 | `handshake`; Provider wraps connection authentication |
| Yunzai / TRSS-Yunzai | OneBot 11 reverse WebSocket | pinned source revision | `documented`; 31 of 59 direct actions have entries |
| Zhenxun | OneBot 11 reverse WebSocket | pinned source revision | `documented`; all 17 explicit core actions have entries |

The API, CLI, and Web console also expose 11 researched candidates: Avilla, OlivOS, Zhamao, Shiro, Simple Robot OneBot, Overflow, Walle, Adachi-BOT, GenshinUID, PepperBot, and NoneBot 1. A candidate only records traceable upstream evidence. It becomes plan-ready after a pinned gate passes.

NapCat, Lagrange, and OpenShamrock are OneBot implementations whose role overlaps the OneBots platform and protocol boundary, so they are not downstream application frameworks.

## Provider boundary

A Provider owns a profile, an optional endpoint resolver, and a configuration renderer. The shared planner owns account routing, OneBots configuration, redacted `<shared-token>` placeholders, limitations, and acceptance checks.

```ts
import {
  defineFrameworkIntegration,
  FrameworkIntegrationRegistry,
} from 'onebots'

FrameworkIntegrationRegistry.register(
  defineFrameworkIntegration({
    profile: {
      id: 'my-framework',
      displayName: 'My Framework',
      kind: 'framework',
      packageName: 'my-framework',
      protocol: 'onebot.v11',
      transport: 'websocket',
      verification: 'documented',
      upstream: 'https://example.com/my-framework',
      defaultFrameworkOrigin: null,
      limitations: [],
    },
    resolveEndpoint: ({ onebotsEndpoint }) =>
      onebotsEndpoint.replace(/^http/, 'ws'),
    renderFrameworkConfig: ({ endpoint }) =>
      `endpoint: ${endpoint}\ntoken: <shared-token>`,
  }),
)
```

An extension registers during module evaluation. The loader tries `@onebots/framework-<name>`, `onebots-framework-<name>`, and the original package name. A failed import, or one that registers no Provider, rolls the registry back.

```bash
# No bot account is required to inspect the catalog
onebots frameworks
onebots frameworks --json

# Load an installed extension before listing or planning
onebots frameworks --register my-framework
onebots frameworks --register @scope/custom-provider \
  --framework my-framework --account telegram.main
```

Extensions execute code inside the OneBots process. Load only packages you deliberately installed and reviewed. The Web console provides the same control on the Solutions page; `POST /api/frameworks/load` is protected by management authentication.

## Generate a ConnectionPlan

```bash
# Zhin connects to OneBots
onebots frameworks --framework zhin --account telegram.main \
  --origin https://bots.example.com/gateway

# OneBots connects to LangBot
onebots frameworks --framework langbot --account qq.main \
  --framework_origin http://langbot:2280
```

The structured result contains the selected profile, protocol, transport, final endpoint, both configurations, checks, and limitations. `onebotsOrigin` may contain a router prefix. `frameworkOrigin` is used only for reverse WebSocket. Origins with credentials, query parameters, or fragments are rejected, and plans never contain real long-lived secrets.

The Web console and API consume the same registry:

- `GET /api/frameworks` returns all profiles and candidates without account configuration;
- `POST /api/frameworks/plan` returns a redacted `schemaVersion: 1` plan;
- `POST /api/frameworks/load` loads an installed Provider from the current dependency root.

## Path and authentication compatibility

Framework-specific behavior remains inside Providers:

- Kovi 0.13.2 generates split `/api` and `/event` channels and double-slash variants. OneBot 11 provides precise, role-isolated routes.
- AstrBot and LangBot use their official aiocqhttp reverse-WebSocket adapters with generated listener configuration.
- AliceBot 0.11.0 incorrectly reads response headers after WebSocket upgrade. Its Provider generates an adapter subclass that validates the request header or query token before upgrade.
- Kotori adapter 2.1.2 has no token option. Its Provider wraps the public `connection(ws, req)` extension point and closes a wrong token with WebSocket code 1008.

The AliceBot and Kotori compatibility code changes only authentication. Event parsing and action calls continue through official upstream adapters. Gates do not pass by disabling authentication, faking a root route, or replacing event models.

## Verification levels

| Level | Meaning | Evidence required |
| --- | --- | --- |
| `documented` | Upstream surface confirmed | package, protocol, fields, and upstream source |
| `handshake` | Pinned basic loop passes | auth, connection, identity, event, and send |
| `messages` | Basic message matrix passes | private/group, reply, image, mention, and ids |
| `actions` | Core action matrix passes | account, friend, group, member, and message actions |
| `verified` | Suitable as a recommended path | pinned CI, reconnect, security boundary, and limitations |

A version upgrade does not inherit evidence. The pinned gate must pass again before profile evidence changes.

## Pinned interoperability gates

The gates use the Mock Adapter and read no real platform credentials:

```bash
pnpm interop:kovi
pnpm interop:astrbot
pnpm interop:langbot
pnpm interop:alicebot
pnpm interop:kotori
```

Each gate covers wrong-token rejection, a valid connection, a private-message event, `get_login_info`, and `send_private_msg`. Python fixtures pin requirements and source revisions; Node, Rust, and Go fixtures use isolated lockfiles so npm never consumes pnpm workspace `catalog:` declarations.

Existing gates also cover NoneBot, Zhin, AlemonJS, Karin, Koishi, melobot, and ZeroBot. Group messages, media, reconnect, malformed frames, and full action matrices belong to later levels, so the UI never presents `handshake` as complete compatibility.

## Upstream references

- [Koishi Satori adapter](https://koishi.chat/en-US/plugins/adapter/satori)
- [NoneBot OneBot adapter](https://onebot.adapters.nonebot.dev/docs/guide/setup/)
- [Karin Milky adapter](https://github.com/KarinJS/karin-plugin-adapter-milky)
- [Zhin OneBot 11 adapter](https://www.npmjs.com/package/@zhin.js/adapter-onebot11)
- [AlemonJS OneBot adapter](https://www.npmjs.com/package/@alemonjs/onebot)
- [AstrBot](https://github.com/AstrBotDevs/AstrBot)
- [LangBot](https://github.com/langbot-app/LangBot)
- [AliceBot](https://github.com/AliceBotProject/alicebot)
- [melobot](https://github.com/Meloland/melobot)
- [ZeroBot](https://github.com/wdvxdr1123/ZeroBot)
- [Kovi](https://github.com/ThriceCola/Kovi)
- [Kotori](https://github.com/kotorijs/kotori)
- [Yunzai](https://yunzai-bot.com/get-started/platform.html)
- [Zhenxun](https://github.com/zhenxun-org/zhenxun_bot)
- [Official OneBot ecosystem](https://onebot.dev/ecosystem)
