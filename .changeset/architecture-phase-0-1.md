---
"@onebots/core": minor
"onebots": minor
---

refactor: Phase 0+1 架构优化

Phase 0: 安全与稳定基线
- fix(service-manager): execSync → execFileSync, getHomeDir() 安全兜底
- fix(app.ts): 空 catch 块加注释或日志输出
- chore(vitest): 测试范围扩展到 adapters/ 和 protocols/

Phase 1: 统一基础设施
- feat(core): 新增 proxy.ts 统一代理 Agent 工厂（createProxyAgent, buildProxyUrl, maskProxyUrl）
- feat(core): 改进 ConnectionManager（logger 注入, onConnected/onMaxRetriesReached 回调）
- refactor: 6 个适配器迁移到共享代理工具, 3 个适配器迁移到 ConnectionManager
- fix(onebots/index.ts): 消除 export * from '@onebots/core'，改为显式导出
