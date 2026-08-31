---
"onebots": patch
---

插件动态导入后会继续验证 CLI 名称对应的适配器或协议工厂及配置 Schema 已完成注册；setup、doctor、前台启动与服务预检会立即拒绝空入口、错误注册名称和缺失 Schema，并给出具体诊断。
