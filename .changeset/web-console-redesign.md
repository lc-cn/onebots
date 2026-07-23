---
"@onebots/web": patch
---

重构 Web 管理端：弃用 Element Plus，改为 Tailwind CSS v4 + 自研轻量组件库（`src/ui/`），图标迁移到 @tabler/icons-vue，字体自托管 Geist。恢复正常语义色（在线/连接中/离线状态可读），重做侧边栏布局、登录页、机器人卡片、配置页（表单/原始配置/站点静态/账号四页签）、系统信息、日志与终端页，统一明暗双主题设计令牌，删除未使用的 Accounts.vue。
