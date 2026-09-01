---
"@onebots/core": patch
"onebots": patch
---

让 `deepClone` 在无法生成独立副本时失败关闭，并在应用初始化、热重载、协议配置继承与账号编辑前克隆合并来源，避免运行配置与调用方对象共享引用。
