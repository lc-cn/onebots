---
"@onebots/core": patch
"onebots": patch
"@onebots/web": patch
---

分离在线主程序与 Core 版本身份：健康端点、Prometheus、系统信息和 Web 分别展示实际 `onebots` 与 `@onebots/core` 版本；doctor 会对比在线主程序与当前 CLI，版本漂移在严格模式下阻止部署。
