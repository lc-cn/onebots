---
"@onebots/core": minor
"onebots": minor
---

refactor: Phase 3-5 架构优化补完

Phase 3: 大文件拆分
- refactor(core): adapter.ts 1562→382 行, ID 管理提取到 adapter-id-manager.ts
- refactor(onebots): app.ts 1209→~400 行, 7 个路由模块 (auth/adapter-api/config/terminal/verification/public-static)

Phase 4: 测试覆盖提升
- test(core): proxy/id-manager/retry 单元测试 (21 用例)
- test(adapter-mock): 完整生命周期集成测试 (86 用例)
- test(protocol): CQ 码解析 + 格式转换测试 (40+ 用例)

Phase 5: 工程规范
- ci: ESLint flat config, no-explicit-any/no-console 门禁
- refactor: 18 适配器 barrel export 清理
- chore: 硬编码超时提取为命名常量
- docs: CONTRIBUTING.md 中文贡献指南
