# ADR-0003: 2026 年度里程碑

- **状态**: 已接受（2026-06-29 修订：IM 网关极致）
- **日期**: 2026-06-29
- **决策者**: lc-cn（/grill-with-docs）

## Q2 P0（4–6 月）— 消息/ID + 连接稳定

| 类型 | 目标 |
|------|------|
| 质量 **P0** | CommonEvent / segment / id_map 一致性；ConnectionManager / 重连 / 代理加固 |
| 质量 **P0** | OneBot v12 WS connect/heartbeat（#215）；Koishi/NoneBot/微信高频 Issue 收敛 |
| 用户可感知 | Heychat adapter 合入（**生产级**验收，非仅「能连上」） |

## Q3（7–9 月）— 国内 Tier 1 做深 + 协议矩阵

| 类型 | 目标 |
|------|------|
| 用户可感知 | clawbot / KOOK / 飞书 / 钉钉：收发删改查在下游框架中一致可用 |
| 质量 | **平台 × 协议** 自动化兼容矩阵（OneBot / Satori / Milky） |
| 质量 | OneBot v12 / Satori / Milky 对照官方文档 gap 清单逐项补齐 |

## Q4（10–12 月）— MCP + 运维

| 类型 | 目标 |
|------|------|
| 用户可感知 | **MCP v1 MVP**（#217 + #218）— 核心 Tools + SSE 入站 + 双传输 + Cursor 示例 |
| 用户可感知 | MCP v2 高级 Tools（#219，可按资源合并或顺延） |
| 质量 | WebConsole / 可观测性；v3.x 发布节奏 review |

## 不做清单（2026）

- OOPZ 官方 adapter（无 API）
- 内置 Agent Runtime（记忆/RAG/编排）
- 在网关 P0 未达标前启动 MCP 实现
- 全量 Adapter API 一次性暴露为 MCP Tools（分 v1/v2 层）

## GitHub Issues 映射

| Issue | 季度 | 说明 |
|-------|------|------|
| #215 | Q2 P0 | OneBot v12 WS |
| #214 | Q2 | Heychat（生产级） |
| #216 | Q2 | 本文档合入 |
| #217 | **Q4** | MCP 协议核心（后移） |
| #218 | **Q4** | MCP 入站 + SDK + 文档（后移） |
| #219 | Q4+ | MCP v2（依赖 #218） |

## 相关

- [ADR-0001 平台优先级](0001-platform-priority-2026.md)
- [ADR-0004 MCP 协议设计](0004-mcp-protocol.md)
- [ADR-0002 协议战略](0002-protocol-strategy.md)
