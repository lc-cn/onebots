# @onebots/adapter-kook

KOOK 官方机器人适配器。直接实现 KOOK REST API、Gateway 和 Webhook，不依赖第三方机器人 SDK。

## 配置

```yaml
kook:
  my-bot:
    account_id: my-bot
    token: your-bot-token
    receive_mode: gateway
```

`gateway` 是默认接收方式，无需公网回调地址。连接断开后会以带抖动的指数退避无限重连，并优先使用 KOOK session 和 sn 恢复事件流。

Webhook 配置示例：

```yaml
kook:
  my-bot:
    account_id: my-bot
    token: your-bot-token
    receive_mode: webhook
    verify_token: your-verify-token
    encrypt_key: optional-encrypt-key
```

在 KOOK 开发者中心填写：

```text
https://你的域名/kook/my-bot/webhook?compress=0
```

`compress=0` 很重要：它让现有 HTTP Host 在解析 JSON 前无需额外处理 deflate 请求体。适配器会完成 challenge、`verify_token` 校验、AES-256-CBC 解密和 sn 去重。反向代理必须保留查询参数和 JSON 请求体。

| 字段           | 说明                                          |
| -------------- | --------------------------------------------- |
| `account_id`   | OneBots 内稳定账号标识                        |
| `token`        | KOOK Bot Token                                |
| `receive_mode` | `gateway` 或 `webhook`                        |
| `verify_token` | Webhook 回调校验 Token                        |
| `encrypt_key`  | Webhook 加密 Key；未启用加密时不填            |
| `api_base_url` | API 根地址，默认 `https://www.kookapp.cn/api` |

## 消息与事件

适配器原生收发文字、KMarkdown、图片、视频、音频、文件、Card、提及和回复。单个媒体段使用对应 KOOK 消息类型；混合富媒体会编译为 Card，不会退化成 Markdown 链接。

Gateway 与 Webhook 进入同一条事件投影链路。频道/私聊消息、回应增删、消息编辑/删除、成员进出和按钮交互会投影成统一事件；其他 KOOK 系统事件以 `custom` notice 交付，并完整保留在 `raw_event` 和 `extensions.kook` 中。

KOOK 的频道消息与私聊消息使用两套 API。`delete_message`、`get_message` 应提供 `scene_type`；当前进程收发过的消息可以从有界上下文自动识别。通用 `update_message` 只适用于当前进程已知场景的消息，其他场景请使用 `call_kook_api` 显式调用。

## 平台扩展动作

除标准 OneBots 动作外，适配器提供以下原生能力：

- `call_kook_api`：安全调用任意 `/v3/*` API，参数为 `path`、`method`、`query`、`body`
- 频道与私聊回应：`get_*_reactions`、`add_*_reaction`、`remove_*_reaction`
- 消息置顶：`pin_message`、`unpin_message`
- 服务器角色：`list/create/update/delete/grant/revoke_guild_role`
- 频道权限：`get/create/update/sync/delete_channel_permission`
- 黑名单：`list_blacklist`、`add_blacklist`、`remove_blacklist`
- 服务器语音静音/闭麦与助力历史：`list/add/remove_guild_mute`、`get_guild_boost_history`
- 邀请：`list_invites`、`create_invite`、`delete_invite`
- 帖子：分区、创建、回复、详情、列表、删除和回复列表
- 语音：移动/踢出用户、查询用户所在语音频道
- 机器人在线状态：上线、下线和查询状态

命名动作的参数字段与 KOOK 官方 API 保持一致。权限不足、参数错误和限流会抛出 `KookApiError`，其中包含 HTTP 状态、KOOK 错误码和请求路径。

## 参考

- [KOOK 开发者文档](https://developer.kookapp.cn/doc/reference)
- [消息接口](https://developer.kookapp.cn/doc/http/message)
- [Webhook](https://developer.kookapp.cn/doc/webhook)
- [Gateway](https://developer.kookapp.cn/doc/websocket)
