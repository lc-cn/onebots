# Milky 协议

Milky 是一个轻量级的机器人通信协议，专为简单场景设计。

## 协议简介

Milky 协议的特点：

- 🪶 **轻量级**: 最小化的协议设计
- ⚡ **高性能**: 低开销的消息传输
- 🎯 **简单易用**: 易于理解和实现
- 🔌 **灵活**: 支持 HTTP 和 WebSocket

## 安装

```bash
npm install @onebots/protocol-milky-v1
```

## 配置

在 `config.yaml` 中配置 Milky 协议：

```yaml
# 全局默认配置
general:
  milky.v1:
    use_http: true
    use_ws: false

# 账号配置
wechat.my_mp:
  milky.v1:
    use_http: true
    use_ws: true
```

## 通信方式

### HTTP API

**地址格式**: `http://localhost:6727/{platform}/{account_id}/milky/v1/{action}`

**示例**:
```bash
# 发送消息
curl -X POST http://localhost:6727/wechat/my_mp/milky/v1/send \
  -H "Content-Type: application/json" \
  -d '{
    "target": "123456",
    "type": "private",
    "content": "Hello World"
  }'
```

### WebSocket

**地址格式**: `ws://localhost:6727/{platform}/{account_id}/milky/v1`

## 消息格式

Milky 使用简单的 JSON 格式：

```json
{
  "type": "message",
  "target": "123456",
  "message_type": "private",
  "content": "Hello",
  "timestamp": 1638360000000
}
```

支持的内容类型：

- 纯文本
- 图片 URL
- 简单的多媒体引用

## API 列表

### 基础 API

- `send` - 发送消息
- `recall` - 撤回消息
- `get_info` - 获取信息
- `get_list` - 获取列表

Milky 协议保持最小 API 集合，只提供最常用的功能。

## 事件类型

基础事件类型：

- `message` - 消息事件
- `notice` - 通知事件
- `request` - 请求事件

每个事件包含基本字段：

```json
{
  "type": "message",
  "time": 1638360000,
  "data": {
    // 事件数据
  }
}
```

## 使用场景

Milky 协议适合以下场景：

- 🎯 **简单机器人**: 只需基础消息收发功能
- ⚡ **性能敏感**: 需要最小通信开销
- 🔧 **自定义框架**: 快速实现自己的机器人框架
- 📱 **轻量级客户端**: 资源受限的环境

## 不适合场景

- ❌ 需要复杂的富文本消息
- ❌ 需要详细的平台特性支持
- ❌ 需要完整的类型系统

对于这些场景，建议使用 OneBot V12 或 Satori。

## 与其他协议对比

| 特性 | Milky | OneBot V11 | OneBot V12 | Satori |
|------|-------|-----------|-----------|--------|
| 复杂度 | ⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 功能完整性 | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 性能 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| 易用性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |

## 快速开始

```javascript
// WebSocket 客户端示例
const ws = new WebSocket('ws://localhost:6727/wechat/my_mp/milky/v1');

ws.on('message', (data) => {
  const event = JSON.parse(data);
  
  if (event.type === 'message') {
    // 处理消息
    console.log('收到消息:', event.data.content);
    
    // 回复
    ws.send(JSON.stringify({
      action: 'send',
      params: {
        target: event.data.sender,
        type: 'private',
        content: '收到！'
      }
    }));
  }
});
```

## 相关链接

- [@onebots/protocol-milky-v1 README](https://github.com/lc-cn/onebots/tree/master/packages/protocol-milky-v1)
- [源码](https://github.com/lc-cn/onebots/tree/master/packages/protocol-milky-v1/src)
