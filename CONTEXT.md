# OneBots 领域上下文

> 本文件供 Agent 与贡献者理解 OneBots 的领域语言、定位与边界。由 `/grill-with-docs` 沉淀，2026-06-29 修订为「IM 网关极致」战略。

## 一句话定位（2026）

**多平台 IM 网关的极致** — 把各 IM 平台的消息、ID、连接，统一成可靠、正确的 CommonEvent，再无损导出到 OneBot / Satori / Milky / MCP。

MCP 是极致网关的 **Agent 出口**，不是品牌主语；网关本体（消息/ID/稳定）优先于新协议与新平台。

## 架构术语

| 术语 | 含义 |
|------|------|
| **Adapter（适配器）** | 连接 IM 平台，将平台原始事件/API 转为统一的 `CommonEvent` 与 Adapter API |
| **Protocol（协议）** | 输出层，将 `CommonEvent` 转为对外报文（OneBot、Satori、Milky、MCP），并处理入站调用 |
| **Account（账号）** | 某平台下的一个 Bot 实例，绑定 Adapter + 若干 Protocol 配置 |
| **CommonEvent** | 框架内统一事件模型，Adapter 产出、Protocol 消费 |
| **id_map** | 平台原始 ID 与统一 ID 的映射（`createId` / `resolveId`） |
| **Segment** | 统一消息段（文本、图片、@ 等），跨平台与协议导出须保持一致 |
| **MCP Tools** | MCP 协议暴露的可调用能力，映射自 Adapter API；**须在网关消息/ID 正确后才有意义** |

## 数据流

```
IM 平台 → Adapter → Account (+ id_map) → Protocol → 下游消费者
                                              ├── OneBot → NoneBot / Koishi
                                              ├── Satori / Milky → 对应生态
                                              └── MCP → Cursor / Claude Agent
```

## 目标用户

维护精力冲突时 **三者平衡**，不设单一绝对优先：

1. **自部署运维者** — 一人管多平台，要稳定、配置简单、Docker 一键起
2. **Bot 框架开发者** — NoneBot / Koishi / Satori 插件作者，要协议兼容、ID 正确
3. **Agent 集成者** — 通过 MCP 操控 IM，要 Tools 清晰、鉴权简单

## 明确不做 / 不推荐

- **单一平台 + 官方 SDK 就够** — 例如只做 Discord.js，不必上 OneBots
- **纯 Python 栈、大量 NoneBot 插件不想改** — 更适合原生 NoneBot + 桥接
- **完整 Agent Runtime** — OneBots 提供 IM 控制面（含 MCP），**不内置** Agent 推理、记忆、多 Agent 编排；那是 Cursor / Claude 的事

## 2026 路线图摘要（网关极致 · 分阶段）

| 阶段 | 主打 |
|------|------|
| **Q2 P0** | 消息/ID/segment 正确性 + 连接稳定；OneBot WS 修复；微信/Koishi Issue 收敛 |
| **Q2** | Heychat 合入（生产级验收） |
| **Q3** | 国内 Tier 1 平台做深 + 平台×协议兼容矩阵 |
| **Q3–Q4** | OneBot / Satori / Milky 合规矩阵 |
| **Q4** | MCP v1 MVP（网关稳定后再上）；运维体验（WebConsole、可观测性） |

详见 [`docs/adr/0003-yearly-milestones.md`](docs/adr/0003-yearly-milestones.md)。

## 相关 ADR

- [0001 平台优先级](docs/adr/0001-platform-priority-2026.md)
- [0002 协议战略](docs/adr/0002-protocol-strategy.md)
- [0003 2026 里程碑](docs/adr/0003-yearly-milestones.md)
- [0004 MCP 协议设计](docs/adr/0004-mcp-protocol.md)
