# Matrix

Matrix 适配器基于当前稳定 Matrix v1.19 Client-Server API 与 Application Service API。它不依赖单独 SDK 进程，也不会另开监听端口：普通机器人、homeserver AppService 和外部事件连接都复用同一个 `MatrixClient`。

## 平台映射

| Matrix | OneBots |
| --- | --- |
| Room | `group`；`m.direct` 标记的 Room 为 `direct` |
| `m.room.message` / `m.sticker` | 消息与媒体段 |
| `m.replace` | `message_updated` |
| `m.reaction` / reaction redaction | `reaction_added` / `reaction_removed` |
| `m.room.redaction` | `message_deleted` |
| `m.room.member` | 成员加入、离开、封禁或机器人房间邀请 |
| `m.typing` / `m.receipt` / `m.presence` | 输入、回执与用户状态通知 |
| 未知、to-device、account-data、加密事件 | `custom`，完整保留 `raw_event` |

房间成员角色按 `m.room.power_levels` 投影：100 及以上为 owner，50–99 为 admin，其余为 member。消息历史、上下文、成员、资料、房间摘要、邀请、移除、加入、离开、已读、编辑、redaction、reaction 和媒体上传均调用官方端点。

`m.typing` 是房间级快照，Client 会维护上一份快照并投影精确的开始/停止增量；`m.direct` 同样按完整账号数据快照更新，解除 Direct Room 不会残留旧状态。

## 三种接收方式

- `sync`：持续调用 `/_matrix/client/v3/sync`，使用 `next_batch` 提交进度。网络或 homeserver 错误默认无限指数退避；`stop()` 用 AbortSignal 立即取消长轮询。
- `appservice`：处理 `PUT /_matrix/app/v1/transactions/{txnId}` 与 `POST /_matrix/app/v1/ping`，严格要求 `Authorization: Bearer <hs_token>`。只有全部协议投递成功才返回 200；失败返回 500，homeserver 可使用同一 txnId 重投。
- `manual`：不创建接收连接、不挂载路由。已有连接调用 `await client.ingest(rawEvent)`；已有 Fetch/WinterCG Host 调用 `await client.acceptHttp(request)`；Koa/Zhin 等 Host 可调用 `ingestHttp()` 并使用结构化响应。

三个入口共享按事件 ID 和 AppService txnId 的可靠去重、顺序投递、原始事件类型和 canonical 投影。监听器失败不会提前提交去重状态。

## 原生扩展动作

除通用消息与房间动作外，适配器公开：

- `call_matrix_api`：受限到已配置 homeserver 的相对 pathname，不允许绝对 URL；
- `create_matrix_room`、`join_matrix_room`、`knock_matrix_room`；
- `ban_matrix_member`、`unban_matrix_member`；
- `set_matrix_room_topic`、`send_matrix_state_event`；
- `send_matrix_typing`、`set_matrix_presence`、`set_matrix_read_markers`；
- `get_matrix_room_state`、`get_matrix_public_rooms`；
- `ping_matrix_appservice`。

## 加密边界

适配器不会把 `m.room.encrypted` 猜成明文，也不会声称支持未实现的 Olm/Megolm 密钥管理。密文事件会以 `custom` 无损交付；需要 E2EE 时，应由已有的加密 Matrix 客户端解密后通过 `manual ingest()` 交给同一 Client。这样不会在网关中产生虚假的“已解密”状态。

配置见 [Matrix 配置](/config/adapter/matrix)。
