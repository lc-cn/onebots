---
"@onebots/core": patch
"onebots": patch
"@onebots/web": patch
---

将管理端的插件默认选择从通用 JSON 输入升级为开放的列表编辑器：当前运行时已验证的插件会作为带包名和版本的建议，第三方插件仍可通过短名或完整包名自由添加。Schema 新增显式的开放选项列表契约，避免把运行时建议误作封闭白名单。
