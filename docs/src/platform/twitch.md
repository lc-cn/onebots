# Twitch

Twitch 适配器基于当前官方 Helix API 与稳定 EventSub 接口。主动 WebSocket、签名 Webhook、已有 HTTP Host、已有 socket 和 `ingest(rawEvent)` 都汇入同一个 `TwitchClient`，不会自行另开监听端口，也不会把 Beta 或平台不存在的语义伪装成稳定能力。

## 资源与消息映射

- Broadcaster Channel → canonical `group` / `channel`；
- Channel Chat → `message_type: channel`；Whisper → `message_type: direct`；
- chat fragment 的 mention、emote、cheermote 与 GIF 保留为结构化消息段；
- reply 使用 Twitch 原生 `reply_parent_message_id`；
- Twitch Chat 没有媒体上传，公开媒体 URL 只能明确降级为文本；
- 未专门投影的稳定或外部接入 EventSub 保留完整 `raw_event` 与 `extensions.twitch`，投影为 `custom` notice。

Twitch 私信没有持久 conversation resource，因此 `create_user_channel` 只把收件人 ID 投影为 direct channel，并明确标记为 emulated。频道成员来自 Get Chatters，不能伪装成完整关注者或订阅者目录。

## 接收与恢复

- `websocket`：等待官方 welcome 后创建订阅；keepalive 超时会触发恢复。官方 `reconnect_url` 先迁移到新连接再关闭旧连接，不重复创建订阅；普通断线获得新 session 后重新订阅并默认无限指数退避。
- `webhook`：自动订阅使用应用令牌；共享 HTTP Host 把原始 body 交给 Client，执行 HMAC-SHA256、timestamp 时窗、challenge 和重复投递处理。
- `manual`：仍验证 OAuth 和机器人身份，但不创建 transport。`acceptHttp()`、`acceptSocket()`、`ingest()` 使用同一严格解析、过滤和可靠去重入口。
- `AbortSignal` 绑定整个生命周期；`owned: false` 的外部 socket 只解绑，不由 SDK 关闭。

Drops 与 Extension Bits 按官方限制只允许 Webhook。Drops 的 `events` 是批量结构：适配器保留 envelope，在同一幂等事务中逐项派发，并用 batch index 生成不冲突的 canonical ID。

## 平台能力

canonical 能力覆盖频道消息、私信、删除消息、频道/成员查询、timeout/ban、moderator、公告、状态与版本。平台动作额外覆盖：

- chat settings、chatters、whisper、announcement、warnings 与 Automod；
- moderator、VIP、blocked terms；
- custom reward/redemption、poll、prediction、raid；
- streams、clips、schedule、videos、games、emotes 与 cheermotes；
- EventSub 订阅管理；
- `call_twitch_api`，作为所有其他 Helix 资源的受控相对路径入口。

能力清单会使用 OAuth validation 返回的 scope 禁用当前令牌不可调用的动作，并按账号 `subscriptions` 禁用无法产生的 canonical 事件。稳定类型、默认版本、condition profile、transport 限制和批处理规则来自同一 EventSub 目录，Web 表单与运行时不会各维护一份易漂移逻辑。

配置见 [Twitch 配置](/config/adapter/twitch)。官方参考：[Helix API](https://dev.twitch.tv/docs/api/reference)、[EventSub](https://dev.twitch.tv/docs/eventsub/)、[Subscription Types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/)、[OAuth Scopes](https://dev.twitch.tv/docs/authentication/scopes/)。
