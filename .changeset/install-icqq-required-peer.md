---
"onebots": patch
"@onebots/adapter-icqq": patch
---

选择 ICQQ 适配器时，将宿主可信目录与适配器 registry 元数据共同声明的 `@icqqjs/icqq` 提升为必需安装依赖；同时重新发布适配器，使其 peer 元数据与当前源码一致。
