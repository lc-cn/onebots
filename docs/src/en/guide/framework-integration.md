# Bot framework integration

OneBots separates platform connectivity from bot application frameworks. OneBots connects to IM platforms and publishes protocol endpoints; Koishi, NoneBot, and similar runtimes consume events and call actions as protocol clients. Integration therefore verifies a shared **protocol version, transport direction, authentication method, and message semantics** instead of rebuilding a platform adapter for every framework.

## Compatibility baseline

The table records integration surfaces currently published by each upstream project. `Interop pending` means a protocol path exists but the OneBots repository does not yet run an end-to-end gate against a pinned framework version. It must not be presented as verified compatibility.

| Downstream | Kind | Preferred path | Alternative | Current conclusion |
| --- | --- | --- | --- | --- |
| Koishi | General framework | Satori | Community OneBot 11 adapter | Interop pending; current Koishi uses Satori v3, so the OneBots `satori.v1` endpoint must be audited first |
| NoneBot2 | General framework | OneBot 11 reverse WebSocket | OneBot 11 forward WebSocket, OneBot 12 | `handshake`: pinned gate passes with NoneBot2 2.5.0 + adapter 2.4.6; full message and action matrices remain pending |
| Karin | General framework | Milky WebSocket | Milky SSE or webhook | An upstream Milky adapter exists; pinned end-to-end verification pending |
| Zhin | General framework | OneBot 11 forward WebSocket | OneBot 11 reverse WebSocket | An upstream OneBot 11 adapter exists; pinned end-to-end verification pending |
| AlemonJS | General framework | OneBot 11 forward WebSocket | OneBot 11 reverse WebSocket | `@alemonjs/onebot` exists upstream; pinned end-to-end verification pending |
| Yunzai / TRSS-Yunzai | Bot distribution | OneBot 11 reverse WebSocket | Depends on the selected distribution | An upstream OneBot 11 ingress exists; private actions and CQ-code assumptions still need verification |
| Zhenxun | NoneBot2 distribution | OneBot 11 reverse WebSocket | Follows NoneBot2 | Uses the NoneBot2 OneBot adapter; Zhenxun plugin dependencies on extended actions need separate verification |

General frameworks and bot distributions need different treatment. NoneBot, Koishi, Karin, Zhin, and AlemonJS provide reusable plugin runtimes. Yunzai and Zhenxun bundle application plugins that may depend on QQ-specific non-standard actions, CQ codes, or fields beyond a successful protocol handshake.

The repository's external-process interop gate produced the NoneBot2 evidence, last verified on 2026-09-02. It starts pinned NoneBot2 and OneBots processes and covers invalid-token rejection, the reverse-WebSocket handshake, a private-message event, `get_login_info`, and `send_private_msg`. This evidence earns the `handshake` level only. Group messages, rich media, reconnect behavior, and the complete action matrix have not passed yet, so the profile is not marked `messages` or `verified`.

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

1. An invalid token fails while the correct token identifies the selected account.
2. Mock-adapter direct and group events reach the downstream with the expected identity, segments, and reply context.
3. Downstream send, delete, login, and member-list calls receive the expected result or a stable unsupported error.
4. The downstream reconnects after OneBots restarts and never accepts the old instance as the replacement.
5. Oversized frames, malformed JSON, and unknown actions do not terminate either process or expose tokens.

Yunzai and Zhenxun also require an extended-action baseline derived from real plugin usage. OneBots should not pretend to implement every NapCat, go-cqhttp, or ICQQ private action. Frequently used capabilities that can be expressed across platforms belong in the shared implementation; the rest stay in an explicit compatibility layer and limitation list.

## Delivery order

1. **NoneBot2 + OneBot 11** now has a pinned fixture, configuration renderer, authentication check, private-message loop, and basic API gate. Group messages, rich media, reconnect behavior, and the action matrix come next.
2. **Zhin + OneBot 11 and AlemonJS + OneBot 11** reuse the forward-WebSocket gate and prove that the deep module covers distinct Node.js frameworks.
3. **Karin + Milky** adds a second protocol and multiple transports, proving the profile seam is not OneBot-specific.
4. **Yunzai and Zhenxun** add distribution-specific private-action and message compatibility after their base frameworks pass.
5. **Koishi** starts with a Satori v3 difference audit and real handshake. If the existing endpoint cannot interoperate, add a separate Satori v3 protocol package instead of mixing two versions inside `satori.v1`.

## Upstream references

- [Koishi Satori adapter](https://koishi.chat/en-US/plugins/adapter/satori)
- [NoneBot OneBot installation and connection](https://onebot.adapters.nonebot.dev/docs/guide/setup/)
- [Karin Milky adapter](https://github.com/KarinJS/karin-plugin-adapter-milky)
- [Zhin OneBot 11 adapter](https://www.npmjs.com/package/@zhin.js/adapter-onebot11)
- [AlemonJS OneBot adapter](https://www.npmjs.com/package/@alemonjs/onebot)
- [Yunzai platform integration](https://yunzai-bot.com/get-started/platform.html)
- [Zhenxun project](https://github.com/zhenxun-org/zhenxun_bot)
