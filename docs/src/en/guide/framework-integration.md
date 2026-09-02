# Bot framework integration

OneBots separates platform connectivity from bot application frameworks. OneBots connects to IM platforms and publishes protocol endpoints; Koishi, NoneBot, and similar runtimes consume events and call actions as protocol clients. Integration therefore verifies a shared **protocol version, transport direction, authentication method, and message semantics** instead of rebuilding a platform adapter for every framework.

## Compatibility baseline

The table records integration surfaces currently published by each upstream project. `Interop pending` means a protocol path exists but the OneBots repository does not yet run an end-to-end gate against a pinned framework version. It must not be presented as verified compatibility.

| Downstream | Kind | Preferred path | Alternative | Current conclusion |
| --- | --- | --- | --- | --- |
| Koishi | General framework | Satori | Community OneBot 11 adapter | `handshake`: pinned gate passes with Koishi 4.18.6 + adapter 1.5.1; the full resource-action matrix remains pending |
| NoneBot2 | General framework | OneBot 11 reverse WebSocket | OneBot 11 forward WebSocket, OneBot 12 | `handshake`: pinned gate passes with NoneBot2 2.5.0 + adapter 2.4.6; full message and action matrices remain pending |
| Karin | General framework | Milky WebSocket | Milky SSE or webhook | `handshake`: pinned gate passes with Karin 1.15.3 + adapter 1.3.3; upstream dependency declaration and security limitations remain |
| Zhin | General framework | OneBot 11 forward WebSocket | OneBot 11 reverse WebSocket | `handshake`: pinned gate passes with Zhin 6.0.15 + adapter 7.0.8; full message and action matrices remain pending |
| AlemonJS | General framework | OneBot 11 forward WebSocket | OneBot 11 reverse WebSocket | `handshake`: pinned gate passes with AlemonJS 2.1.103 + adapter 2.1.21; an upstream dependency security limitation remains |
| Yunzai / TRSS-Yunzai | Bot distribution | OneBot 11 reverse WebSocket | Depends on the selected distribution | documented: 31 of 59 direct actions in a pinned source revision have protocol entries; 28 private actions remain unsupported |
| Zhenxun | NoneBot2 distribution | OneBot 11 reverse WebSocket | Follows NoneBot2 | documented: all 17 explicit core actions in a pinned source revision have entries; the full process and third-party plugins remain pending |

## Expanded ecosystem candidates

The seven baseline profiles are integration paths with a configuration renderer or a pinned source audit. They are not the whole ecosystem that OneBots can potentially serve. Based on the [official OneBot ecosystem](https://onebot.dev/ecosystem) and upstream project repositories, the management API, CLI, and Web console now expose 18 additional researched candidates:

| Priority | Candidates | Rationale |
| --- | --- | --- |
| Next | AstrBot, LangBot, AliceBot, melobot, Kovi, ZeroBot, Kotori | Their upstream projects publish clear OneBot or Milky surfaces suitable for pinned process gates |
| Later | Avilla, OlivOS, Zhamao, Shiro, Simple Robot OneBot, Overflow, Walle, Adachi-BOT, GenshinUID | A protocol surface exists, but WIP status, multiple hosts, SDK embedding, or private actions increase the audit cost |
| Migration | PepperBot, NoneBot 1 | Kept as migration leads for existing deployments rather than preferred choices for new projects |

A catalog entry means that traceable upstream evidence exists. It is not a compatibility promise. A candidate becomes a plan-ready profile only after its connection direction, configuration fields, authentication, events, and actions pass a pinned-version gate.

NapCat, Lagrange, and OpenShamrock are OneBot **protocol implementations** whose role overlaps OneBots' platform and protocol edge. They are not downstream application frameworks consuming OneBots events, so they are outside this candidate list. SDKs, bridges, and plugin distributions are also classified separately because they require different acceptance gates.

General frameworks and bot distributions need different treatment. NoneBot, Koishi, Karin, Zhin, and AlemonJS provide reusable plugin runtimes. Yunzai and Zhenxun bundle application plugins that may depend on QQ-specific non-standard actions, CQ codes, or fields beyond a successful protocol handshake.

The repository's external-process interop gate produced the NoneBot2 evidence, last verified on 2026-09-02. It starts pinned NoneBot2 and OneBots processes and covers invalid-token rejection, the reverse-WebSocket handshake, a private-message event, `get_login_info`, and `send_private_msg`. This evidence earns the `handshake` level only. Group messages, rich media, reconnect behavior, and the complete action matrix have not passed yet, so the profile is not marked `messages` or `verified`.

The pinned Zhin gate uses the real `OneBot11WsEndpoint` and Zhin Endpoint event boundary. It covers invalid-token rejection, the forward-WebSocket handshake, a private-message event, `get_login_info`, and `send_private_msg`. Dependencies live in an isolated `interop/zhin/package-lock.json`, preventing npm from reading pnpm workspace `catalog:` declarations. This evidence also earns `handshake` only; group messages, rich media, reconnect behavior, side events, and the complete action matrix remain pending.

The AlemonJS gate uses its official `OneBotClient`, v11 event driver, and action API for the same forward-WebSocket baseline. The pinned dependency audit on 2026-09-02 reports two moderate denial-of-service advisories in `file-type` (`GHSA-5v7r-6r5c-r473` and `GHSA-j47w-4g3g-c36v`), with the current AlemonJS version pinning an affected release. A passing handshake therefore cannot advance to `verified`, and the audit tool's breaking downgrade must not replace the current runtime.

The Karin gate loads the real `node-karin@1.15.3` runtime and `@karinjs/plugin-adapter-milky@1.3.3`. It covers invalid-token rejection, Milky HTTP initialization, the WebSocket handshake, friend-message conversion, `get_login_info`, `get_impl_info`, and `send_private_message`. The adapter's 1.3.3 package imports but does not declare `node-karin`, so standalone installations must add that dependency explicitly. Its pinned `yaml@2.7.0` is affected by the moderate stack-overflow advisory `GHSA-48c2-rrv3-qjmp`, and `npm audit` currently offers no automatic fix. Group messages, rich media, reconnect behavior, SSE, webhook, and the full action matrix remain pending, so the evidence stays at `handshake`.

The Koishi gate loads `koishi@4.18.6` and the official `@koishijs/plugin-adapter-satori@1.5.1`. The adapter treats its configured `endpoint` as the Satori root and appends `/v1/events` and `/v1/{method}` itself, so the generated endpoint is `.../satori` rather than the duplicated `.../satori/v1`. The gate covers invalid-token rejection, IDENTIFY/READY, a direct-message event, and `message.create`. OneBots returns direct Satori results to the official client while preserving the existing `{ data }` wrapper for legacy callers. The pinned audit contains 12 moderate entries propagated from `file-type` advisory `GHSA-5v7r-6r5c-r473`; its suggested fix is a breaking downgrade and was not applied automatically.

The Yunzai matrix audits its OneBotv11 adapter at [TRSS-Yunzai revision 2d1652ac899e](https://github.com/TimeRainStarSky/Yunzai/commit/2d1652ac899e8f4338b5310171319e6894b2499c). It finds 59 direct sendApi actions. OneBots now has entries for 31, including newly exposed friend deletion, direct/group history, and direct/group forwarded messages. The remaining 28 mainly cover group files, notices, guilds, QQ profile operations, and implementation-specific actions. This is a pinned static source audit, not a full Yunzai process gate, so the level stays documented.

The Zhenxun matrix audits explicit OneBot API use at [Zhenxun revision 39ed1ade1469](https://github.com/zhenxun-org/zhenxun_bot/commit/39ed1ade1469318d53b5beb943f05b89664d294e). All 17 identified core actions now have OneBot v11 entries, including friend deletion and group forwarded messages added in this round. Dynamic call_api, third-party plugins, and the complete distribution process are outside this static result; it does not earn actions or verified.

## Integration interface

The implementation will use one deep module to produce a `ConnectionPlan`. A caller supplies a framework, OneBots account, and public origin; the module selects the protocol, renders both configurations, and returns executable checks:

```ts
interface FrameworkConnectionRequest {
  framework: 'koishi' | 'nonebot' | 'karin' | 'zhin' | 'alemonjs' | 'yunzai' | 'zhenxun'
  account: `${string}.${string}`
  onebotsOrigin?: string
  frameworkOrigin?: string
}

interface ConnectionPlan {
  protocol: 'onebot.v11' | 'onebot.v12' | 'satori.v1' | 'milky.v1'
  transport: 'websocket' | 'reverse-websocket' | 'sse' | 'webhook'
  endpoint: string
  onebotsConfig: string
  frameworkConfig: string
  checks: Array<{ name: string; command?: string; expected: string }>
  limitations: string[]
}
```

Framework-specific facts remain in profile data and a small set of renderers. Protocol URLs, token handling, account routing, redaction, and probes are implemented once. The CLI, Web wizard, documentation, and interop fixtures all consume the same profiles so four separate descriptions cannot drift independently. `FrameworkProfile.evidence` records the verified framework and adapter versions, date, command, and checks; profiles without pinned evidence omit this field.

`onebotsOrigin` is the HTTP origin from which the framework reaches OneBots and may include the Router prefix. `frameworkOrigin` is used only for reverse WebSocket plans and names the listener that OneBots reaches inside NoneBot, Yunzai, or Zhenxun. The module rejects origins containing a username, password, query, or fragment. Generated output contains only a `<shared-token>` placeholder, so a long-lived credential does not enter terminal history or archived evidence.

## Generate connection configuration

List every profile without creating an account:

```bash
onebots frameworks
onebots frameworks --json
```

Supply an existing or planned OneBots account to render the account protocol fragment, downstream configuration, endpoint, and checks:

```bash
# Forward WebSocket: Zhin connects to OneBots
onebots frameworks --framework zhin --account telegram.main \
  --origin https://bots.example.com/gateway

# Reverse WebSocket: OneBots connects to NoneBot
onebots frameworks --framework nonebot --account wechat.work \
  --framework_origin http://nonebot:8080
```

`--json` emits a structured `ConnectionPlan` with `schemaVersion: 1` for deployment tooling. Generation never edits `config.yaml`; review the plan and replace `<shared-token>` with the same secret on both sides before applying it.

The Web console's Framework Integration page consumes the same profiles. GET /api/frameworks returns the full catalog even when no bot exists, while POST /api/frameworks/plan renders the same redacted plan. The server validates the framework, account, and URLs and rejects credentials, query parameters, or fragments.

## Verification levels

Every profile publishes a level. The UI and CLI must not turn “an upstream adapter exists” into “verified by OneBots.”

| Level | Meaning | Required evidence |
| --- | --- | --- |
| `documented` | Upstream connection method is identified | Upstream documentation, package, protocol version, and configuration fields |
| `handshake` | A connection can be established | Authentication, login identity, reconnect, and diagnostic tests |
| `messages` | Basic message loop passes | Direct/group receive and send, replies, images, mentions, and message IDs |
| `actions` | Core action loop passes | Account, friend, group, member, and message action matrix |
| `verified` | Safe to recommend | CI against pinned versions, known limitations, and a last-verified timestamp |

An upstream version upgrade does not inherit `verified`. Evidence is updated only after the pinned matrix passes again.

## Interoperability gate

Each framework fixture runs as an external process or container. Snapshot tests of profile data are insufficient. The minimum gate is:

Run the NoneBot2 gate from the repository root:

```bash
python -m pip install -r interop/nonebot/requirements.txt
pnpm interop:nonebot
```

CI and the release workflow run the same command. The gate uses pinned dependencies, reads no real platform credentials, and uses the mock adapter for bidirectional calls.

Install and run the Zhin gate from its isolated lockfile:

```bash
npm ci --prefix interop/zhin --ignore-scripts
pnpm interop:zhin
```

AlemonJS uses the same isolated installation boundary:

```bash
npm ci --prefix interop/alemonjs --ignore-scripts
pnpm interop:alemonjs
```

The Karin fixture explicitly pins both packages because the published adapter omits its runtime dependency:

```bash
npm ci --prefix interop/karin --ignore-scripts
pnpm interop:karin
```

Koishi uses the official Satori adapter and an isolated lockfile:

```bash
npm ci --prefix interop/koishi --ignore-scripts
pnpm interop:koishi
```

1. An invalid token fails while the correct token identifies the selected account.
2. Mock-adapter direct and group events reach the downstream with the expected identity, segments, and reply context.
3. Downstream send, delete, login, and member-list calls receive the expected result or a stable unsupported error.
4. The downstream reconnects after OneBots restarts and never accepts the old instance as the replacement.
5. Oversized frames, malformed JSON, and unknown actions do not terminate either process or expose tokens.

Yunzai and Zhenxun also require an extended-action baseline derived from real plugin usage. OneBots should not pretend to implement every NapCat, go-cqhttp, or ICQQ private action. Frequently used capabilities that can be expressed across platforms belong in the shared implementation; the rest stay in an explicit compatibility layer and limitation list.

## Delivery order

1. **NoneBot2 + OneBot 11** now has a pinned fixture, configuration renderer, authentication check, private-message loop, and basic API gate. Group messages, rich media, reconnect behavior, and the action matrix come next.
2. **Zhin + OneBot 11 and AlemonJS + OneBot 11** now both have pinned forward-WebSocket baselines. Expand their message, reconnect, and action matrices while tracking the AlemonJS upstream dependency fix.
3. **Karin + Milky** now has a pinned WebSocket baseline, proving the profile seam is not OneBot-specific. Add SSE, webhook, reconnect, group-message, rich-media, and action matrices next while tracking the upstream dependency declaration and `yaml` fix.
4. **Yunzai and Zhenxun** now have pinned source-action matrices and shared friend-deletion, history, and forwarded-message entries. The next step is a full distribution process gate and explicit handling of the remaining private actions.
5. **Koishi** now has a pinned official-Satori handshake, direct-message, and send gate. Add group messages, rich media, reconnect behavior, and the complete resource-action matrix next.
6. **Expanded ecosystem** starts with AstrBot, LangBot, AliceBot, melobot, Kovi, ZeroBot, and Kotori. Each candidate must pin a version and pass a minimal connection and action loop before receiving a configuration renderer.

## Upstream references

- [Koishi Satori adapter](https://koishi.chat/en-US/plugins/adapter/satori)
- [NoneBot OneBot installation and connection](https://onebot.adapters.nonebot.dev/docs/guide/setup/)
- [Karin Milky adapter](https://github.com/KarinJS/karin-plugin-adapter-milky)
- [Zhin OneBot 11 adapter](https://www.npmjs.com/package/@zhin.js/adapter-onebot11)
- [AlemonJS OneBot adapter](https://www.npmjs.com/package/@alemonjs/onebot)
- [Yunzai platform integration](https://yunzai-bot.com/get-started/platform.html)
- [Zhenxun project](https://github.com/zhenxun-org/zhenxun_bot)
- [Official OneBot ecosystem](https://onebot.dev/ecosystem)
- [AstrBot](https://github.com/AstrBotDevs/AstrBot)
- [LangBot](https://github.com/langbot-app/LangBot)
- [AliceBot](https://github.com/AliceBotProject/alicebot)
- [melobot](https://github.com/Meloland/melobot)
- [Kovi](https://github.com/ThriceCola/Kovi)
- [Kotori](https://github.com/kotorijs/kotori)
