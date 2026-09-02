# Shiro

Shiro 已纳入统一 Application 注册表，但状态为 `planned`，当前不能通过 `-t shiro` 激活。OneBots 会明确拒绝启动，避免把调研资料误报为可运行支持。

| 项目 | 当前值 |
| --- | --- |
| Application ID | `shiro` |
| 候选协议 | `onebot.v11` |
| 状态 | `planned` |

## 尚缺的实现

需固定 Spring Boot starter 版本与会话配置。

完成标准是提供同名 Application 包或内置实现、协议扩展能力描述、固定版本互操作门禁，然后才能把状态提升为 `available`。
