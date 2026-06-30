# ADR-0001: 2026 平台优先级

- **状态**: 已接受
- **日期**: 2026-06-29
- **决策者**: lc-cn（/grill-with-docs）

## 背景

OneBots monorepo 含 19 个 adapter，无法全量 deep maintenance。需明确 Tier 划分与社区贡献策略。

## 决策

### Tier 1 — 必维护（国内 IM 优先）

官方承诺 bug 响应、文档更新、与 Protocol 变更同步：

- **微信系**（内部优先 **wechat-clawbot** > 公众号 wechat > wecom / wecom-kf）
- **KOOK / QQ**
- **飞书 / 钉钉**
- **Heychat（黑盒语音）** — Q2 合入后归入 Tier 1

### Tier 2 — 社区驱动

- 合入 monorepo、过 CI、有 README
- **不承诺** maintainer 级 bug SLA
- 低使用量 adapter：Zulip、Email、Teams 等
- **欢迎社区 PR 新 adapter**，Review 通过后归 Tier 2

### Tier 3 — 等待 / 不主动维护

- **OOPZ** — 无官方 Bot API，Issue #212 结论：暂缓，等官方能力

## 后果

- Issue / PR 优先级按 Tier 排序
- Tier 1 平台是 MCP v1 集成验证的首选（KOOK + wechat-clawbot）
- OOPZ Issue 可 close 或 label `wontfix` 直至 API 可用
