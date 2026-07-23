# @onebots/adapter-heychat

## 3.0.0

### Major Changes

- feat: 黑盒语音 (Heychat) 官方机器人适配器首次发布
  - WebSocket 长连接、ConnectionManager 自动重连与心跳
  - 斜杠命令 (type=50) 与普通频道消息 (type=5，实验性)
  - 频道消息发送/删除与房间信息查询
  - 统一 ID 映射（resolveId）与 core 代理工具
