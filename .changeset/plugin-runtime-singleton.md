---
"onebots": patch
"@onebots/adapter-mock": patch
---

在导入扩展前拒绝绑定到另一份 `onebots` 或 `@onebots/core` 的插件，并把 Mock 适配器改为共享宿主运行时的 peer dependency。
