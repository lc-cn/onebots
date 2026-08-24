# @onebots/adapter-heychat

## 4.0.4

### Patch Changes

- Updated dependencies [41f4bcc]
  - onebots@1.2.5

## 4.0.3

### Patch Changes

- Updated dependencies [f472ebf]
  - onebots@1.2.4

## 4.0.2

### Patch Changes

- Updated dependencies [1f79a8a]
  - onebots@1.2.3

## 4.0.1

### Patch Changes

- Updated dependencies [4fd55a6]
  - onebots@1.2.2

## 4.0.0

### Major Changes

- d9e67a0: feat(adapter-heychat): 新增黑盒语音官方机器人适配器
  - WebSocket 长连接、心跳与自动重连
  - 斜杠命令 (type=50) 与普通频道消息 (type=5，实验性)
  - 频道消息发送/删除与房间信息查询

### Patch Changes

- Updated dependencies [0519d6d]
- Updated dependencies [d9e67a0]
- Updated dependencies [fa90690]
  - onebots@1.2.1

## 3.0.0

### Major Changes

- feat: 黑盒语音 (Heychat) 官方机器人适配器首次发布
  - WebSocket 长连接、ConnectionManager 自动重连与心跳
  - 斜杠命令 (type=50) 与普通频道消息 (type=5，实验性)
  - 频道消息发送/删除与房间信息查询
  - 统一 ID 映射（resolveId）与 core 代理工具
