# Satori V1 协议实现

该目录实现 `@onebots/protocol-satori-v1` 的协议运行时，边界分为：

- `index.ts`：CommonEvent 投影、协议编排与宿主路由。
- `actions.ts`：只接受 Satori 规范的 `resource.method` 动作名并统一分派。
- `actions-message.ts`：消息与频道资源。
- `actions-directory.ts`：Guild、成员、用户、好友与登录资源。
- `channel-routes.ts`：维护不透明 `channel_id` 到通用消息场景的显式路由。

## 传输

- HTTP：`POST /{platform}/{account_id}/satori/v1/{resource}.{method}`
- 登录信息：`GET /{platform}/{account_id}/satori/v1/login`
- WebSocket：`/{platform}/{account_id}/satori/v1/events`
- Webhook：可配置多个目标，每项可覆盖全局 Token

HTTP 与 WebSocket 均使用 `Authorization: Bearer <token>`。WebSocket 客户端发送 IDENTIFY 后，READY 中的登录身份来自 Adapter 的真实 `getLoginInfo()` 结果。

消息路由从真实事件和频道目录学习，不使用 ID 前缀或分隔符猜测。能力无法唯一判定的未知频道会明确拒绝，避免把消息投递到错误场景。

## 动作映射

| Satori 资源             | Adapter 契约                                                              |
| ----------------------- | ------------------------------------------------------------------------- |
| `message.*`             | `sendMessage/getMessage/deleteMessage/updateMessage/getMessageHistory`    |
| `channel.*`             | `getChannelInfo/getChannelList/createChannel/updateChannel/deleteChannel` |
| `guild.*`               | `getGuildInfo/getGuildList`                                               |
| `guild.member.get/list` | `getGuildMemberInfo/getGuildMemberList`                                   |
| `user.*`                | `getUserInfo/createUserChannel`                                           |
| `friend.*`              | `getFriendList/deleteFriend`                                              |
| `login.get`             | `getLoginInfo`                                                            |

协议不再提供 `createMessage`、`getGuildList` 等 camelCase 兼容别名。未进入规范目录但由适配器明确声明的原生动作，仍通过统一 `callAction()` 边界调用。

## 事件

`dispatch()` 只接受框架 `CommonEvent`，随后投影为 Satori Event 并通过所有启用的出口可靠投递。预格式化的协议事件不会被当作 CommonEvent 接收，避免绕过过滤与身份投影。
