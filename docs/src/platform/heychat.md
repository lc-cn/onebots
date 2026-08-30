# 黑盒语音（Heychat）适配器

黑盒语音适配器使用官方 REST API 管理消息、房间、频道、角色与语音能力，并通过官方正向 WebSocket 或宿主已有事件源接收推送。

## 能力摘要

- 发送私聊、频道 Markdown、图片、@、回复与卡片消息
- 更新、删除频道消息以及添加或取消消息回应
- 查询房间、频道、成员、角色、权限和语音状态，并执行对应管理动作
- 投影官方斜杠命令（`type=50`）、回应（`5003`）、成员变更（`3001`）与卡片交互
- 未知官方事件以 `custom` + `raw_event` 无损交付，不把未公开的 `type=5` 伪造成普通消息
- 正向 WebSocket 无限重连、可取消心跳、代次隔离与指数退避
- manual 模式通过 `await HeychatBot.ingest()` 或 `acceptWebSocket()` 复用已有 Host，协议投影成功后才确认事件

## 安装与配置

在[机器人控制台](https://bot.xiaoheihe.cn)创建机器人、注册斜杠命令并邀请机器人进入房间：

```bash
pnpm add @onebots/adapter-heychat
```

```yaml
heychat.my_bot:
  token: your_bot_token
  receive_mode: websocket # 或 manual
```

`websocket` 由适配器建立官方正向连接并负责心跳与无限恢复。`manual` 不创建事件连接，仍保留 REST 出站能力；已有 Host 可投递结构化原始事件，或把 `ws` 已升级 socket 交给同一个 Bot。socket 的心跳、关闭和重连仍由宿主管理。

## 频道场景 ID

黑盒语音频道 API 同时需要房间 ID 与频道 ID。适配器使用 `room_id:channel_id` 作为稳定 `scene_id`；收到该频道事件后，也可通过有界上下文缓存解析单独的频道 ID。

## 平台扩展

除通用动作外，适配器公开消息、角色、房间表情、频道、邀请、权限、语音成员与在线媒体流等官方动作。`call_heychat_api` 仅允许官方 chatroom API 安全路径，`upload_media` 复用统一的 25 MiB 媒体管线。

完整动作、消息段、结构化错误与高级配置见[包内 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-heychat)。

## 相关链接

- [配置说明](/config/adapter/heychat)
- [官方 API 文档](https://s.apifox.cn/43256fe4-9a8c-4f22-949a-74a3f8b431f5)
- [官方 Demo](https://github.com/QingFengOpen/HeychatDemo)
