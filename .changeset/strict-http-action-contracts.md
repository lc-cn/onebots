---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-kook": patch
"@onebots/adapter-heychat": patch
---

新增可复用的声明式 HTTP 平台动作契约，统一校验字段、类型、范围、条件必填、对象数组及 POST query/body；KOOK 迁移到该公共契约，Heychat 的 36 个官方动作按领域拆分并关闭任意参数透传。
