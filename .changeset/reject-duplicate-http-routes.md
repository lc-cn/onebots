---
"@onebots/core": patch
onebots: patch
---

共享 Router 现在会拒绝重复的 HTTP 方法与精确路径，并在数组路径中的任一项冲突时原子撤销整次注册，避免后注册账号或扩展显示可用却始终无法收到回调。
