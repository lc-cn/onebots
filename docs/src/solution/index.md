# 解决方案

解决方案描述 OneBots 如何与下游系统协作。平台文档回答“消息从哪里来”，协议文档回答“消息如何对外暴露”，解决方案则回答“谁来消费这些协议，以及怎样形成可验证的业务闭环”。

## 机器人框架

[机器人框架解决方案](/solution/frameworks)覆盖 Koishi、NoneBot、Karin、Zhin、AlemonJS、AstrBot、LangBot、AliceBot、Kovi、Kotori 等下游。每个可用方案都由一个 Framework Integration Provider 提供：

- profile：框架版本、协议、传输方向、验证等级和限制；
- 端点解析：把 OneBots 账号路由转换成框架实际使用的连接地址；
- 配置渲染：生成两端共享鉴权信息的脱敏模板；
- 固定版本证据：记录互操作命令和已经通过的检查项。

Provider 可以内置，也可以由扩展包动态注册。它不接管 IM 平台连接，也不实现协议出口；它只封装一种下游框架的兼容与部署方案。
