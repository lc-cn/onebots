# Mattermost

Mattermost 适配器面向当前 Mattermost Server REST API v4 与官方 WebSocket 协议。它把 REST、主动可靠 WebSocket、已有 socket 和最底层 `ingest(rawEvent)` 放在同一个 `MattermostClient` 中，不另开端口，也不为平台不存在的语义制造兼容层。

## 资源映射

- Mattermost Direct Channel（`D`）→ `direct`；
- Group Message Channel（`G`）→ `group`；
- Public / Private Channel（`O` / `P`）→ `channel`；
- Team → `guild`；
- Post / Thread / File / Reaction 分别映射 canonical 消息、thread 段、文件段和 reaction notice。

GDM 成员关系由 Mattermost 创建时确定，适配器不会把不存在的 GDM 增删成员接口伪装成 canonical 群管理。Team、Channel 和成员列表会自动遍历 REST v4 的 200 条分页边界。

## 接收与恢复

- `websocket`：连接 `/{部署子路径}/api/v4/websocket`，发送官方 `authentication_challenge`。断线默认无限指数退避；重连带上 `connection_id` 和最后已见 `sequence_number`，序列缺口会进入日志和 `missed` 事件。
- `manual`：账号仍使用 REST 验证身份，但不建立连接。宿主可调用 `acceptSocket()` 注入已连接 socket，或用 `ingest()` 提交解码后的官方 event envelope。
- `AbortSignal` 在首次握手后仍绑定整个生命周期；取消会停止重连并关闭自有连接。外部 `owned: false` socket 只解绑，不由 SDK 关闭。

所有 WebSocket 数据都会运行时校验。`post`、`reaction`、`user`、`channel` 与 `team` 的字符串化 JSON 会先解析再校验；同一事件只有下游全部成功后才提交去重键，失败可安全重投。未知插件和未来事件投影为 `custom`，原始 envelope 保留在 `raw_event`。

## 平台能力

除 canonical 消息、目录、文件、reaction、pin 和 read marker 外，适配器还提供受控平台动作：

- post 搜索、ephemeral post 与 scheduled post；
- DM / GDM、Channel、Team 与成员管理；
- status、typing 与 WebSocket status actions；
- Channel Bookmarks、custom emoji、Bot Account、slash command；
- `call_mattermost_api`：仅允许同一实例 `/api/v4` 下的安全相对路径。

管理、Bot 与成员动作取决于 token permission；Scheduled Posts 取决于服务器功能和许可证。Web 能力面板会按账号的 `event_types`、`receive_mode` 和当前 socket 状态显示实际可达能力。

配置见 [Mattermost 配置](/config/adapter/mattermost)。官方参考：[REST API](https://api.mattermost.com/)、[WebSocket API](https://developers.mattermost.com/integrate/reference/websocket/)、[Bot Accounts](https://developers.mattermost.com/integrate/reference/bot-accounts/)。
