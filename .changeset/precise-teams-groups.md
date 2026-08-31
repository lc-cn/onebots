---
"@onebots/adapter-teams": patch
---

严格区分 Teams groupChat 与团队频道，canonical Group 不再混入 channel 会话，频道继续通过保留真实上下文的原生动作访问。
