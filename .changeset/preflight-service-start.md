---
"onebots": patch
---

`onebots start` 与 `onebots restart` 现在会根据已保存的服务工作目录重新加载插件并校验当前配置；预检失败时不会启动服务，重启预检失败时也不会先停止正在运行的实例。插件候选名解析已在前台运行、doctor 和服务预检之间统一。
