# 机器人框架接入

OneBots 把平台连接与机器人业务框架分开：OneBots 负责连接 IM 平台并提供协议出口，Koishi、NoneBot 等框架作为协议客户端消费事件和调用动作。接入工作的核心是验证双方共同支持的**协议版本、传输方向、鉴权方式和消息语义**，而不是为每个框架重新实现一个平台适配器。

## 当前兼容基线

下表记录的是上游已经公开的接入面。`待互操作验证` 表示协议路径存在，但 OneBots 仓库尚未用该框架的固定版本运行端到端门禁；它不能被宣传为已验证兼容。

| 下游 | 类型 | 首选接入面 | 备选 | 当前结论 |
| --- | --- | --- | --- | --- |
| Koishi | 通用框架 | Satori | OneBot 11 社区适配器 | `handshake`：Koishi 4.18.6 + adapter 1.5.1 已通过固定版本门禁；完整资源动作矩阵待验证 |
| NoneBot2 | 通用框架 | OneBot 11 反向 WebSocket | OneBot 11 正向 WebSocket、OneBot 12 | `handshake`：NoneBot2 2.5.0 + adapter 2.4.6 已通过固定版本门禁；完整消息与动作矩阵待验证 |
| Karin | 通用框架 | Milky WebSocket | Milky SSE、Webhook | `handshake`：Karin 1.15.3 + adapter 1.3.3 已通过固定版本门禁；存在上游依赖声明与安全限制 |
| Zhin | 通用框架 | OneBot 11 正向 WebSocket | OneBot 11 反向 WebSocket | `handshake`：Zhin 6.0.15 + adapter 7.0.8 已通过固定版本门禁；完整消息与动作矩阵待验证 |
| AlemonJS | 通用框架 | OneBot 11 正向 WebSocket | OneBot 11 反向 WebSocket | `handshake`：AlemonJS 2.1.103 + adapter 2.1.21 已通过固定版本门禁；存在上游依赖安全限制 |
| 云崽 / TRSS-Yunzai | 机器人发行版 | OneBot 11 反向 WebSocket | 由具体分支决定 | 上游已有 OneBot 11 入口，需验证其私有动作和 CQ 码假设 |
| 真寻 | NoneBot2 发行版 | OneBot 11 反向 WebSocket | 跟随 NoneBot2 | 上游基于 NoneBot2 OneBot 适配器，需额外验证真寻插件依赖的扩展动作 |

“框架”和“机器人发行版”需要分开处理。NoneBot、Koishi、Karin、Zhin 与 AlemonJS 提供通用插件运行时；云崽和真寻包含大量现成业务插件，除了协议握手，还可能依赖 QQ 生态形成的非标准动作、CQ 码或字段。

NoneBot2 的证据由仓库中的真实进程互操作门禁产生，最近一次验证日期为 2026-09-02。门禁启动固定版本的 NoneBot2 和 OneBots，已经覆盖错误 token 拒绝、反向 WebSocket 握手、私聊事件、`get_login_info` 与 `send_private_msg`。这份证据只对应 `handshake` 等级；群消息、富媒体、重连和完整动作矩阵尚未通过，因此不标记为 `messages` 或 `verified`。

Zhin 的固定版本门禁使用真实 `OneBot11WsEndpoint` 和 Zhin Endpoint 事件边界，覆盖错误 token 拒绝、正向 WebSocket 握手、私聊事件、`get_login_info` 与 `send_private_msg`。依赖保存在独立的 `interop/zhin/package-lock.json` 中，避免 npm 读取 pnpm workspace 的 `catalog:` 声明。当前证据同样只对应 `handshake`；群消息、富媒体、重连、侧事件和完整动作矩阵仍待验证。

AlemonJS 门禁使用官方 `OneBotClient`、v11 事件驱动和动作 API，覆盖相同的正向 WebSocket 基础闭环。2026-09-02 的固定依赖审计报告 `file-type` 存在两个中等级拒绝服务公告（`GHSA-5v7r-6r5c-r473`、`GHSA-j47w-4g3g-c36v`），而 AlemonJS 当前固定受影响版本；因此即使握手通过，也不能提升为 `verified`，更不能用审计工具建议的破坏性降级版本替换当前运行时。

Karin 门禁加载真实 `node-karin@1.15.3` 与 `@karinjs/plugin-adapter-milky@1.3.3`，覆盖错误 token 拒绝、Milky HTTP 初始化、WebSocket 握手、好友消息转换、`get_login_info`、`get_impl_info` 与 `send_private_message`。插件 1.3.3 的发布包会导入但未声明 `node-karin`，因此独立安装必须显式加入该依赖。固定依赖中的 `yaml@2.7.0` 受中等级栈溢出公告 `GHSA-48c2-rrv3-qjmp` 影响，当前 `npm audit` 没有可用自动修复；群消息、富媒体、重连、SSE、Webhook 与完整动作矩阵也尚未通过，所以验证等级保持 `handshake`。

Koishi 门禁加载 `koishi@4.18.6` 与官方 `@koishijs/plugin-adapter-satori@1.5.1`。官方插件把配置中的 `endpoint` 当作 Satori 根地址并自行追加 `/v1/events` 与 `/v1/{method}`；模板因此输出 `.../satori`，而不是重复版本段的 `.../satori/v1`。门禁覆盖错误 token、IDENTIFY/READY、私聊事件和 `message.create`，并验证 OneBots 对官方客户端返回直接 Satori 结果，同时为既有调用者保留 `{ data }` 包装。固定依赖审计有 12 个中等级条目，均由 `file-type` 的 `GHSA-5v7r-6r5c-r473` 沿依赖链传播；当前审计建议是破坏性降级，未自动应用。

## 接入接口

后续实现使用一个深模块生成 `ConnectionPlan`。调用者只需要提供框架、OneBots 账号和公开 origin，模块负责选择协议、构造两端配置并给出验证步骤：

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

框架差异留在 profile 数据和少量渲染器中。协议 URL、token 处理、账号路由、配置脱敏和探测逻辑只实现一次。CLI、Web 向导、文档示例与互操作测试都消费同一份 profile，避免四套说明逐渐漂移。`FrameworkProfile.evidence` 记录已验证的框架版本、适配器版本、日期、命令和检查项；没有固定版本证据的 profile 不提供该字段。

`onebotsOrigin` 是框架访问 OneBots 的 HTTP origin，可以包含网关的 Router 前缀；`frameworkOrigin` 只用于反向 WebSocket，是 OneBots 访问 NoneBot、云崽或真寻监听端的地址。模块拒绝带用户名、密码、查询参数或 fragment 的 origin，生成结果只包含 `<shared-token>` 占位符，不会把真实长期凭据写进终端历史或归档。

## 生成连接配置

不创建账号也可以查看全部接入 profile：

```bash
onebots frameworks
onebots frameworks --json
```

指定已经存在或准备创建的 OneBots 账号后，命令会生成账号协议片段、框架配置、端点和验证步骤：

```bash
# 正向 WebSocket：Zhin 主动连接 OneBots
onebots frameworks --framework zhin --account telegram.main \
  --origin https://bots.example.com/gateway

# 反向 WebSocket：OneBots 主动连接 NoneBot
onebots frameworks --framework nonebot --account wechat.work \
  --framework_origin http://nonebot:8080
```

`--json` 输出 `schemaVersion: 1` 的结构化 `ConnectionPlan`，可供部署工具消费。生成模板不会修改 `config.yaml`，用户核对方案并替换两端相同的 `<shared-token>` 后再写入配置。

## 验证等级

每个 profile 必须公开一个等级，页面和 CLI 不得把“存在上游适配器”显示成“经过 OneBots 验证”。

| 等级 | 含义 | 所需证据 |
| --- | --- | --- |
| `documented` | 已确认上游接入方式 | 上游文档、包名、协议版本和配置字段 |
| `handshake` | 可以建立连接 | 鉴权、登录身份、断线重连和错误诊断测试 |
| `messages` | 基础消息闭环通过 | 私聊/群聊收发、回复、图片、提及和消息 ID |
| `actions` | 核心动作闭环通过 | 账号、好友、群、成员和消息动作兼容矩阵 |
| `verified` | 可作为推荐方案 | 固定双方版本的 CI、已知限制和最近验证时间 |

版本升级后不会自动继承 `verified`。只有固定版本矩阵重新通过，才更新验证证据。

## 互操作门禁

每个框架的测试夹具应作为外部进程或容器运行，禁止只对 profile 做快照测试。最小门禁包括：

NoneBot2 门禁可在仓库根目录执行：

```bash
python -m pip install -r interop/nonebot/requirements.txt
pnpm interop:nonebot
```

CI 与发版流程都会运行同一命令。门禁使用固定依赖，不读取真实平台凭据，并通过 mock 适配器完成双向调用。

Zhin 门禁使用独立 lockfile 安装并运行：

```bash
npm ci --prefix interop/zhin --ignore-scripts
pnpm interop:zhin
```

AlemonJS 使用相同的隔离安装边界：

```bash
npm ci --prefix interop/alemonjs --ignore-scripts
pnpm interop:alemonjs
```

Karin 的发布包没有声明运行时框架依赖，夹具显式固定两者版本：

```bash
npm ci --prefix interop/karin --ignore-scripts
pnpm interop:karin
```

Koishi 使用官方 Satori 适配器及独立 lockfile：

```bash
npm ci --prefix interop/koishi --ignore-scripts
pnpm interop:koishi
```

1. 使用错误 token 时连接失败，正确 token 能识别目标账号。
2. Mock 适配器触发私聊与群聊事件，下游收到正确身份、消息段和回复上下文。
3. 下游发起发送、撤回、查询账号和查询群成员动作，OneBots 返回符合该框架预期的结果或稳定的不支持错误。
4. OneBots 重启后下游能够重连，旧实例响应不会被当成新连接。
5. 超大帧、畸形 JSON 和未知动作不会使任一进程退出或泄露 token。

云崽和真寻还需要从真实插件使用情况整理“扩展动作基线”。OneBots 不应无条件伪造 NapCat、go-cqhttp 或 ICQQ 的所有私有动作；高频且能跨平台表达的能力进入通用实现，其余动作通过明确的兼容层和限制清单提供。

## 实施顺序

1. **NoneBot2 + OneBot 11**：已建立固定版本夹具、配置模板、鉴权、私聊收发和基础 API 调用门禁；下一步补群消息、富媒体、重连和动作矩阵。
2. **Zhin + OneBot 11、AlemonJS + OneBot 11**：两者都已完成固定版本正向 WebSocket 基础门禁；继续补齐消息、重连和动作矩阵，并跟踪 AlemonJS 上游依赖修复。
3. **Karin + Milky**：已完成固定版本 WebSocket 基础门禁，证明 profile seam 不是 OneBot 专用；下一步补 SSE、Webhook、重连、群消息、富媒体与动作矩阵，并跟踪上游依赖声明和 `yaml` 修复。
4. **云崽与真寻**：在基础框架通过后补充发行版的私有动作与消息兼容矩阵。
5. **Koishi**：已完成官方 Satori 适配器的固定版本握手、私聊和发送门禁；继续补群消息、富媒体、重连与完整资源动作矩阵。

## 上游依据

- [Koishi Satori 适配器](https://koishi.chat/en-US/plugins/adapter/satori)
- [NoneBot OneBot 安装与连接](https://onebot.adapters.nonebot.dev/docs/guide/setup/)
- [Karin Milky 适配器](https://github.com/KarinJS/karin-plugin-adapter-milky)
- [Zhin OneBot 11 适配器](https://www.npmjs.com/package/@zhin.js/adapter-onebot11)
- [AlemonJS OneBot 适配器](https://www.npmjs.com/package/@alemonjs/onebot)
- [云崽平台接入](https://yunzai-bot.com/get-started/platform.html)
- [真寻项目说明](https://github.com/zhenxun-org/zhenxun_bot)
