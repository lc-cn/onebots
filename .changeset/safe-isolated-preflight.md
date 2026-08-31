---
"onebots": patch
---

管理端重启预检改为在一次性 CLI 子进程中执行，避免失败预检污染在线进程的插件 Registry、加载清单和 ESM 模块缓存。
