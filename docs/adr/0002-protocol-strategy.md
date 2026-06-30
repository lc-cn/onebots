# ADR-0002: 2026 协议战略

- **状态**: 已接受（2026-06-29 修订：网关极致优先）
- **日期**: 2026-06-29
- **决策者**: lc-cn（/grill-with-docs）

## 背景

OneBots 输出层现有 OneBot v11/v12、Satori v1、Milky v1，规划 MCP v1 为第五条输出线。2026 战略调整为 **IM 网关极致**：消息/ID/连接稳定为 P0，协议扩展服从于网关质量。

## 决策

### 优先级（资源冲突时）

1. **网关核心** — CommonEvent / segment / id_map 正确性；连接稳定（重连、代理、ConnectionManager）
2. **OneBot v11/v12** — 现有用户基本盘，NoneBot/Koishi 兼容 Issue 收敛
3. **Satori / Milky** — 维持同步；Q3–Q4 合规矩阵补齐
4. **MCP v1** — Q4 交付（设计保留于 ADR-0004，**等网关 P0 达标后再开发**）

### 五协议定位

| 协议 | 下游 | 2026 策略 |
|------|------|-----------|
| OneBot v11/v12 | NoneBot、Koishi 等 | **P0** 合规 + bug 收敛 |
| Satori v1 | Koishi Satori 生态 | Q3–Q4 合规矩阵 |
| Milky v1 | Milky 生态 | Q3–Q4 合规矩阵 |
| **MCP v1** | Cursor、Claude Desktop 等 Agent | **Q4** MVP；网关稳定为前提 |

### MCP 与 OneBot 关系

- **并列输出**，共享同一 Adapter / Account，非替代关系
- MCP Tools 映射 Adapter API；若 id_map/segment 有误，MCP 只会放大错误，故 **排在网关 P0 之后**

## 后果

- Q2–Q3 不启动 MCP 实现（#217/#218 后移至 Q4）
- Issue 资源优先：协议层 bug、adapter 消息/ID、兼容矩阵
- ADR-0004 设计文档仍有效，作为 Q4 实施依据

## 相关

- [ADR-0004 MCP 协议设计](0004-mcp-protocol.md)
- [ADR-0003 2026 里程碑](0003-yearly-milestones.md)
