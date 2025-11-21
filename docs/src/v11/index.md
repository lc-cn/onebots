# OneBot V11 协议

OneBot V11 是基于 OneBot 11 标准的实现，完全兼容 CQHTTP 接口。

## 标准参考

- 官方仓库：https://github.com/botuniverse/onebot-11
- 官方文档：https://11.onebot.dev

## 文档导航

- [动作 (Action)](/v11/action) - API 接口文档
- [事件 (Event)](/v11/event) - 事件类型文档
- [CQ码 (CQ Code)](/v11/cqcode) - 消息段格式文档

## 快速开始

### 配置示例

```yaml
protocols:
  - protocol: onebot
    version: v11
    use_http: true
    use_ws: true
    http_reverse:
      - http://localhost:5000/onebot
    ws_reverse:
      - ws://localhost:5000/ws
    enable_cors: true
    access_token: ""
    secret: ""
```

### 通信方式

OneBot V11 支持四种通信方式：

1. **HTTP** - 提供 HTTP API 接口
2. **WebSocket** - 提供 WebSocket 连接
3. **HTTP POST (反向)** - 主动推送事件
4. **WebSocket (反向)** - 主动连接到客户端

### 消息格式

支持两种消息格式：

- **字符串格式 (CQ码)**：`[CQ:type,param1=value1,param2=value2]`
- **数组格式**：`[{type: "type", data: {param1: "value1"}}]`

## 特性

- ✅ 完整的 OneBot 11 API 实现
- ✅ 支持所有标准消息段类型
- ✅ CQ 码自动解析和生成
- ✅ 消息 ID 自动转换（字符串 ↔ 整数）
- ✅ 事件过滤器支持
- ✅ 多种通信方式

## 平台支持

本实现支持所有实现了 Adapter 接口的平台，包括但不限于：

- QQ（官方机器人）
- 微信
- 钉钉
- 其他自定义平台

不同平台对 OneBot V11 标准的支持程度可能不同，某些 API 或事件可能不可用。
