# Zulip

Zulip 适配器按官方 REST API 与 Event Queue 工作，支持频道（Channel）、话题（Topic）和私聊。实时连接为 `POST /register` 注册队列后持续 `GET /events` 长轮询。

## 平台映射

| Zulip | OneBots |
| --- | --- |
| Channel + Topic | `group` / `channel` 场景，ID 为 `stream_id/topic` |
| Direct message | `private` 场景，ID 为用户 ID 或逗号分隔用户 ID |
| Organization user | 用户；不伪装成“好友” |
| Channel subscribers | 群成员 |
| Reaction | `reaction_added` / `reaction_removed` |
| Realm user event | `user_added` / `user_updated` / `user_removed` |
| 其他 Event Queue 事件 | `custom`，完整保留 `raw_event` |

## 消息与文件

文本直接使用 Zulip-flavored Markdown。`at` 会先查询真实用户名称并生成带用户 ID 的 Zulip 提及；远程图片/文件以 Markdown 链接发送，本地路径或 Base64 数据先通过 `/user_uploads` 上传。获取消息、消息历史、编辑、删除、已读和星标均走官方接口。

频道列表来自可访问 Channel；成员列表调用 `/streams/{stream_id}/members`，不会再用整个组织成员列表伪装频道成员。邀请、移除和退订使用官方 subscriptions API。

## 可靠事件队列

- 使用服务器返回的 `queue_id` 与 `last_event_id` 顺序确认事件。
- `BAD_EVENT_QUEUE_ID` 时重新注册队列。
- 网络错误默认无限指数退避，成功后恢复在线状态。
- `stop()` 通过 AbortSignal 取消长轮询并删除服务器队列。
- 用户事件监听器抛错不会中断后续事件消费。

## 原生扩展

适配器公开消息反应、星标、搜索、编辑历史、已读回执、Markdown 渲染、频道创建/更新/归档、订阅、话题可见性、Presence、用户状态、Typing、Emoji、附件与服务器信息动作。未封装端点可通过受限 `call_zulip_api` 调用。

独立集成可直接使用包导出的 `ZulipClient`，并通过 `ingest(rawEvent)` 把已有连接的事件送入统一管线。

配置见 [Zulip 配置](/config/adapter/zulip)，完整用法见包内 README。
