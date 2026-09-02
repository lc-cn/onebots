# 机器人框架解决方案

OneBots 将机器人系统拆成三个独立扩展方向：

- **Adapter** 连接 IM 平台并产生统一事件；
- **Protocol** 把统一能力暴露为 OneBot、Satori、Milky 等协议；
- **Framework Integration Provider** 描述下游框架如何连接、鉴权、配置和验收。

因此，Zhin、NoneBot 或 Koishi 不需要成为新的平台 Adapter。它们作为协议客户端，由 Provider 生成端点、两端配置和固定版本证据。用户即使尚未配置 bot，也能查看完整框架能力目录。

## 已提供的方案

`handshake` 表示固定版本已通过错误 token 拒绝、连接、私聊事件和至少一个查询及发送动作。它不代表群聊、富媒体、重连和完整动作矩阵已经验证。

| 下游 | 协议与传输 | 固定版本 | 结论 |
| --- | --- | --- | --- |
| Koishi | Satori 正向 WebSocket | 4.18.6 / adapter 1.5.1 | `handshake` |
| NoneBot2 | OneBot 11 反向 WebSocket | 2.5.0 / adapter 2.4.6 | `handshake` |
| Karin | Milky WebSocket | 1.15.3 / adapter 1.3.3 | `handshake` |
| Zhin | OneBot 11 正向 WebSocket | 6.0.15 / adapter 7.0.8 | `handshake`；首个独立内置 Provider |
| AlemonJS | OneBot 11 正向 WebSocket | 2.1.103 / adapter 2.1.21 | `handshake` |
| melobot | OneBot 11 正向 WebSocket | 3.4.0 / 内置 adapter | `handshake` |
| ZeroBot | OneBot 11 正向 WebSocket | 1.8.2 / 内置 driver | `handshake` |
| Kovi | OneBot 11 分离 WebSocket | 0.13.0 / kovi-onebot 0.13.2 | `handshake`；支持 `/api`、`/event` 及上游双斜杠路径 |
| AstrBot | OneBot 11 反向 WebSocket | 4.28.0b1 / aiocqhttp 1.4.4 | `handshake` |
| LangBot | OneBot 11 反向 WebSocket | 4.10.9 / 内置 adapter | `handshake` |
| AliceBot | OneBot 11 反向 WebSocket | 0.11.0 / CQHTTP adapter 0.11.0 | `handshake`；Provider 修复上游握手鉴权缺陷 |
| Kotori | OneBot 11 反向 WebSocket | 1.7.5 / adapter 2.1.2 | `handshake`；Provider 增加 connection 鉴权包装 |
| 云崽 / TRSS-Yunzai | OneBot 11 反向 WebSocket | 固定源码版本 | `documented`；31/59 个直接动作已有入口 |
| 真寻 | OneBot 11 反向 WebSocket | 固定源码版本 | `documented`；17/17 个明确核心动作已有入口 |

管理 API、CLI 和 Web 管理端还公开 11 个已有上游依据的候选，包括 Avilla、OlivOS、炸毛框架、Shiro、Simple Robot OneBot、Overflow、Walle、Adachi-BOT、GenshinUID、PepperBot 和 NoneBot 1。候选只表示调研可追溯，不等同于兼容承诺；通过固定版本门禁后才会升级为可生成 `ConnectionPlan` 的 profile。

NapCat、Lagrange、OpenShamrock 等是 OneBot 协议实现端，职责与 OneBots 的平台接入和协议出口重叠，因此不列为下游机器人框架。

## Provider 扩展边界

Provider 拥有一个 profile、可选的端点解析器和配置渲染器。公共规划器统一处理账号路由、OneBots 配置、`<shared-token>` 脱敏占位符、限制和验收清单。

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

扩展包在模块求值期间完成注册。加载器会依次尝试 `@onebots/framework-<name>`、`onebots-framework-<name>` 和原始包名；导入失败或未注册任何 Provider 时，注册表会回滚到加载前状态。

```bash
# 查看内置方案和调研候选，不要求已经配置 bot
onebots frameworks
onebots frameworks --json

# 加载已安装扩展，然后查看或生成方案
onebots frameworks --register my-framework
onebots frameworks --register @scope/custom-provider \
  --framework my-framework --account telegram.main
```

扩展会在 OneBots 进程中执行代码，只应加载已经审查并主动安装的包。Web 管理端的“解决方案”页面提供同一加载入口；HTTP 接口为 `POST /api/frameworks/load`，并受管理端鉴权保护。

## 生成 ConnectionPlan

```bash
# Zhin 主动连接 OneBots
onebots frameworks --framework zhin --account telegram.main \
  --origin https://bots.example.com/gateway

# OneBots 主动连接 LangBot
onebots frameworks --framework langbot --account qq.main \
  --framework_origin http://langbot:2280
```

结构化结果包含选定 profile、协议、传输方向、最终端点、OneBots 配置、框架配置、验收步骤和限制。`onebotsOrigin` 可包含网关 Router 前缀；`frameworkOrigin` 只用于反向 WebSocket。规划器拒绝带凭据、查询参数或 fragment 的 origin，也不会写入真实长期密钥。

Web 管理端和 API 消费相同的注册表：

- `GET /api/frameworks`：返回全部 profile 和候选，不依赖账号配置；
- `POST /api/frameworks/plan`：生成脱敏的 `schemaVersion: 1` 方案；
- `POST /api/frameworks/load`：从当前依赖根加载已安装 Provider。

## 路径与鉴权兼容

框架差异留在 Provider，而不会污染平台 Adapter：

- Kovi 0.13.2 会生成 `/api`、`/event` 双通道以及双斜杠地址。OneBot 11 transport 为这些路径提供角色隔离的精确兼容端点。
- AstrBot 与 LangBot 使用官方 aiocqhttp 反向 WebSocket adapter，Provider 分别生成其监听配置。
- AliceBot 0.11.0 在 WebSocket 升级后错误地从响应头读取 token。Provider 生成一个握手前检查请求头和查询 token 的 adapter 子类。
- Kotori adapter 2.1.2 没有 token 配置。Provider 通过其公开的 `connection(ws, req)` 扩展点包装鉴权，错误 token 以 WebSocket 1008 关闭。

AliceBot 与 Kotori 的兼容代码只处理鉴权边界；事件解析和动作调用继续使用上游官方 adapter。门禁不通过关闭鉴权、伪造根路径或替换事件模型来获得成功。

## 验证等级

| 等级 | 含义 | 所需证据 |
| --- | --- | --- |
| `documented` | 已确认上游接入方式 | 包名、协议、配置字段和上游依据 |
| `handshake` | 固定版本基础闭环通过 | 鉴权、连接、身份、事件和基础发送 |
| `messages` | 基础消息矩阵通过 | 私聊、群聊、回复、图片、提及和消息 ID |
| `actions` | 核心动作矩阵通过 | 账号、好友、群、成员和消息动作 |
| `verified` | 可作为推荐方案 | 固定版本 CI、重连、安全边界和已知限制 |

版本升级不会自动继承验证等级。只有固定版本门禁重新通过，才能更新 profile 的 `evidence`。

## 固定版本互操作门禁

门禁使用 Mock Adapter，不读取真实平台凭据。新增方案分别运行真实框架 adapter 边界：

```bash
pnpm interop:kovi
pnpm interop:astrbot
pnpm interop:langbot
pnpm interop:alicebot
pnpm interop:kotori
```

每条门禁至少检查错误 token 拒绝、正确连接、私聊事件、`get_login_info` 和 `send_private_msg`。Python 夹具通过固定 requirements 与源码 revision 重建；Node、Rust 和 Go 夹具使用独立 lockfile，避免消费 pnpm workspace 的 `catalog:` 声明。

已有门禁还包括 NoneBot、Zhin、AlemonJS、Karin、Koishi、melobot 和 ZeroBot。群消息、富媒体、重连、畸形帧和完整动作矩阵仍属于下一验证等级，页面不会把 `handshake` 显示成全面兼容。

## 上游依据

- [Koishi Satori 适配器](https://koishi.chat/en-US/plugins/adapter/satori)
- [NoneBot OneBot 适配器](https://onebot.adapters.nonebot.dev/docs/guide/setup/)
- [Karin Milky 适配器](https://github.com/KarinJS/karin-plugin-adapter-milky)
- [Zhin OneBot 11 适配器](https://www.npmjs.com/package/@zhin.js/adapter-onebot11)
- [AlemonJS OneBot 适配器](https://www.npmjs.com/package/@alemonjs/onebot)
- [AstrBot](https://github.com/AstrBotDevs/AstrBot)
- [LangBot](https://github.com/langbot-app/LangBot)
- [AliceBot](https://github.com/AliceBotProject/alicebot)
- [melobot](https://github.com/Meloland/melobot)
- [ZeroBot](https://github.com/wdvxdr1123/ZeroBot)
- [Kovi](https://github.com/ThriceCola/Kovi)
- [Kotori](https://github.com/kotorijs/kotori)
- [云崽](https://yunzai-bot.com/get-started/platform.html)
- [真寻](https://github.com/zhenxun-org/zhenxun_bot)
- [OneBot 官方生态目录](https://onebot.dev/ecosystem)
