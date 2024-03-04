# QQ

| 字段名      | 类型                                               | 描述                      | 默认值 |
|----------|--------------------------------------------------|-------------------------|-----|
| versions | [OneBotWithVersion\<'V11'\|'V12'\>](./common.md) | 该机器人的OneBot配置，将覆盖全局通用配置 | -   |
| protocol | [Protocol](#Protocol)                            | QQ机器人协议配置               | 必填  |

## Protocol

| 字段名     | 类型                  | 描述           | 默认值   |
|---------|---------------------|--------------|-------|
| secret  | string              | qq机器人秘钥      | 必填    |
| sandbox | boolean             | 是否沙箱环境       | false |
| intents | [Intent](#Intent)[] | 需要监听的intents | []    |
## Intent
- Intent 为 QQ 官方配置，可填值参考 下表

| 值                       | 描述                   |
|-------------------------|----------------------|
| GROUP_AT_MESSAGE_CREATE | 群聊@事件 没有群聊权限请注释      |
| C2C_MESSAGE_CREATE      | 私聊事件 没有私聊权限请注释       |
| DIRECT_MESSAGE          | 频道私信事件               |
| GUILD_MESSAGES          | 私域机器人频道消息事件，公域机器人请注释 |
| PUBLIC_GUILD_MESSAGES   | 公域机器人频道消息事件，私域机器人请注释 |
| GUILDS                  | 频道变更事件               |
| GUILD_MEMBERS           | 频道成员变更事件             |
| GUILD_MESSAGE_REACTIONS | 频道消息表态事件             |
| INTERACTION             | 互动事件                 |
