---
"@onebots/adapter-discord": patch
---

抽离 Discord Interaction 确定性路由器；组件处理器现在优先精确匹配，并在重叠规则中选择最长前缀，不再依赖注册顺序。
