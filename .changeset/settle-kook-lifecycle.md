---
"@onebots/adapter-kook": patch
---

闭合 KOOK 启停代次与异步生命周期语义，停止时等待事件队列并在 socket 关闭失败后继续完成清理。
