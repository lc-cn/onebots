# Overflow

Overflow 已纳入统一 Application 注册表，但状态为 `planned`，当前不能通过 `-t overflow` 激活。OneBots 会明确拒绝启动，避免把调研资料误报为可运行支持。

| 项目 | 当前值 |
| --- | --- |
| Application ID | `overflow` |
| 候选协议 | `onebot.v11` |
| 状态 | `planned` |

## 尚缺的实现

需单独验证 Mirai 事件模型与 OneBot 字段映射。

完成标准是提供同名 Application 包或内置实现、协议扩展能力描述、固定版本互操作门禁，然后才能把状态提升为 `available`。
