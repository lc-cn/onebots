---
"@onebots/core": patch
"@onebots/docs": patch
"onebots": patch
---

收敛机器人框架 Application 的职责：移除专用传输和状态动作，区分真实扩展动作、框架依赖动作与已知缺口，并让所有传输继续由账号协议配置显式控制。

将 25 个框架解决方案重写为可执行的 OneBots 配置、框架端连接、验证和故障修复手册；同时修复框架配置生成命令的本地构建入口、默认参数以及 Satori 鉴权字段。
