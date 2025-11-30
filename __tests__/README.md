# OneBots 测试套件

基于多协议标准的完整测试套件：
- [OneBot 11 标准](https://11.onebot.dev/)
- [OneBot 12 标准](https://12.onebot.dev/)
- [Milky 协议](https://milky.ntqqrev.org/)
- [Satori 协议](https://satori.chat/)

## 📚 文档索引

- **[📊 测试总览](./TESTING_OVERVIEW.md)** - 完整测试统计和覆盖率报告（139 APIs, 23 文件, 268+ 测试）
- **[🔐 鉴权测试报告](./AUTH_TESTING_REPORT.md)** - HTTP/WebSocket/WebHook/WS-Reverse 鉴权测试
- **[📋 OneBot 12 请求头测试](./ONEBOT12_HEADERS_TESTING.md)** - OneBot 12 标准请求头验证
- **[🥛 Milky V1 测试文档](./MILKY_V1_TESTING.md)** - Milky 协议完整测试指南（59 APIs + 3 事件推送）
- **[🌸 Satori V1 测试文档](./SATORI_V1_TESTING.md)** - Satori 协议完整测试指南（21 APIs + WebSocket）

## 📁 测试结构

```
__tests__/
├── onebot/                    # OneBot 协议测试
│   ├── utils/                 # 公共测试工具
│   │   ├── http-client.js     # HTTP 客户端工具
│   │   ├── ws-client.js       # WebSocket 客户端工具
│   │   └── test-server.js     # 测试服务器工具（WebHook/WS-Reverse）
│   ├── v11/                   # OneBot 11 测试
│   │   ├── http/              # HTTP 通信测试
│   │   │   └── api.spec.js    # API 功能测试
│   │   ├── webhook/           # HTTP Reverse (WebHook) 测试
│   │   │   └── http-reverse.spec.js
│   │   └── websocket/         # WebSocket 通信测试
│   │       ├── connection.spec.js    # 正向 WebSocket
│   │       └── ws-reverse.spec.js    # 反向 WebSocket
│   └── v12/                   # OneBot 12 测试
│       ├── http/              # HTTP 通信测试
│       │   └── api.spec.js    # API 功能测试
│       └── websocket/         # WebSocket 通信测试
│           ├── connection.spec.js    # 正向 WebSocket
│           └── ws-reverse.spec.js    # 反向 WebSocket
├── milky/                     # Milky 协议测试
│   ├── utils/                 # 公共测试工具
│   │   └── http-client.js     # HTTP 客户端工具
│   └── v1/                    # Milky V1 测试
│       ├── http/              # HTTP 通信测试
│       │   ├── api.spec.js    # 59 个 API 测试
│       │   └── auth.spec.js   # 鉴权测试
│       ├── websocket/         # WebSocket 通信测试
│       │   └── event.spec.js  # WebSocket 事件推送
│       ├── sse/               # SSE 通信测试
│       │   └── event.spec.js  # SSE 事件推送
│       └── webhook/           # WebHook 通信测试
│           └── event.spec.js  # WebHook 事件推送
├── satori/                    # Satori 协议测试
│   ├── utils/                 # 公共测试工具
│   │   └── http-client.js     # HTTP 客户端工具
│   └── v1/                    # Satori V1 测试
│       ├── http/              # HTTP 通信测试
│       │   ├── api.spec.js    # 21 个 API 测试
│       │   └── auth.spec.js   # 鉴权测试
│       └── websocket/         # WebSocket 通信测试
│           └── event.spec.js  # WebSocket 事件推送
└── README.md                  # 本文档
```

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动服务器

```bash
pnpm dev
```

### 3. 运行测试

```bash
# 配置环境变量
export PLATFORM=dingtalk
export ACCOUNT_ID=dingl4hqvwwxewpk6tcn

# 运行所有测试
pnpm test -- --run
```

## 🎯 运行特定测试

```bash
# === OneBot 协议测试 ===
# 所有 OneBot 测试
pnpm test -- --run onebot

# 只运行 OneBot V11
pnpm test -- --run onebot/v11

# 只运行 OneBot V12
pnpm test -- --run onebot/v12

# === Milky 协议测试 ===
# 所有 Milky 测试
pnpm test -- --run milky

# Milky HTTP API 测试 (59 个 API)
pnpm test -- --run milky/v1/http/api

# Milky 鉴权测试
pnpm test -- --run milky/v1/http/auth

# Milky WebSocket 事件测试
pnpm test -- --run milky/v1/websocket

# Milky SSE 事件测试
pnpm test -- --run milky/v1/sse

# Milky WebHook 事件测试
pnpm test -- --run milky/v1/webhook

# === Satori 协议测试 ===
# 所有 Satori 测试
pnpm test -- --run satori

# Satori HTTP API 测试 (21 个 API)
pnpm test -- --run satori/v1/http/api

# Satori 鉴权测试
pnpm test -- --run satori/v1/http/auth

# Satori WebSocket 事件测试
pnpm test -- --run satori/v1/websocket

# === 通用测试类型 ===

# 只运行 HTTP 测试
pnpm test -- --run http

# 只运行 WebSocket 测试
pnpm test -- --run websocket

# 运行 WebHook 测试
pnpm test -- --run webhook

# 运行反向 WebSocket 测试
pnpm test -- --run ws-reverse
```

## 🔄 WebHook 和反向 WebSocket 测试

### WebHook (HTTP Reverse) 测试

WebHook 测试验证 OneBot 通过 HTTP POST 主动推送事件的功能。

**配置示例** (`config.yaml`):
```yaml
accounts:
  - platform: dingtalk
    account_id: your_account_id
    protocols:
      onebot:
        v11:
          http_reverse: ["http://localhost:18080"]
```

**运行测试**:
```bash
pnpm vitest run __tests__/onebot/v11/webhook/http-reverse.spec.js
```

测试将：
1. 启动一个 HTTP 服务器监听端口 18080
2. 等待 OneBots 推送事件
3. 验证接收到的事件格式
4. 检查心跳事件

### 反向 WebSocket (WS-Reverse) 测试

反向 WebSocket 测试验证 OneBots 主动连接到外部 WebSocket 服务器的功能。

**配置示例** (`config.yaml`):
```yaml
accounts:
  - platform: dingtalk
    account_id: your_account_id
    protocols:
      onebot:
        v11:
          ws_reverse: ["ws://localhost:18081"]
        v12:
          ws_reverse: ["ws://localhost:18082"]
```

**运行测试**:
```bash
# OneBot V11 反向 WebSocket
pnpm vitest run __tests__/onebot/v11/websocket/ws-reverse.spec.js

# OneBot V12 反向 WebSocket
pnpm vitest run __tests__/onebot/v12/websocket/ws-reverse.spec.js
```

测试将：
1. 启动一个 WebSocket 服务器
2. 等待 OneBots 主动连接
3. 接收推送的事件
4. 发送 API 调用并验证响应
5. 验证事件格式和心跳

### 端口配置

默认端口分配：
- WebHook (V11): `18080`
- WS-Reverse (V11): `18081`
- WS-Reverse (V12): `18082`

可以在测试文件中修改 `CONFIG.webhookPort` 或 `CONFIG.wsReversePort` 来更改端口。

## 📊 测试覆盖统计

### 协议覆盖

| 协议 | 版本 | API 测试 | 鉴权测试 | 事件推送测试 | 文档 |
|------|------|---------|---------|------------|------|
| **OneBot** | V11 | ✅ 36 APIs | ✅ 完整 | ✅ WebSocket/WebHook/WS-Reverse | [文档](./AUTH_TESTING_REPORT.md) |
| **OneBot** | V12 | ✅ 23 Actions | ✅ 完整 | ✅ WebSocket/WS-Reverse | [文档](./ONEBOT12_HEADERS_TESTING.md) |
| **Milky** | V1 | ✅ 59 APIs | ✅ 完整 | ✅ WebSocket/SSE/WebHook | [文档](./MILKY_V1_TESTING.md) |
| **Satori** | V1 | ✅ 21 APIs | ✅ 完整 | ✅ WebSocket | [文档](./SATORI_V1_TESTING.md) |

### 测试文件统计

**总计**: 23 个测试文件

#### OneBot 协议 (10 个文件)
- OneBot V11 HTTP: 1 个
- OneBot V11 WebSocket: 2 个 (正向 + 反向)
- OneBot V11 WebHook: 1 个
- OneBot V11 鉴权: 2 个
- OneBot V12 HTTP: 1 个
- OneBot V12 WebSocket: 2 个 (正向 + 反向)
- OneBot V12 Headers: 1 个

#### Milky 协议 (5 个文件)
- Milky V1 HTTP API: 1 个 (59 APIs)
- Milky V1 HTTP 鉴权: 1 个
- Milky V1 WebSocket: 1 个
- Milky V1 SSE: 1 个
- Milky V1 WebHook: 1 个

#### Satori 协议 (3 个文件)
- Satori V1 HTTP API: 1 个 (21 APIs)
- Satori V1 HTTP 鉴权: 1 个
- Satori V1 WebSocket: 1 个

### API 覆盖详情

| 协议 | API 数量 | 覆盖率 | 说明 |
|------|---------|--------|------|
| OneBot V11 | 36 | 100% | 完整覆盖所有 API |
| OneBot V12 | 23 | 100% | 完整覆盖所有 Action |
| Milky V1 | 59 | 100% | 完整覆盖所有 API |
| Satori V1 | 21 | 100% | 完整覆盖所有 API |
| **总计** | **139** | **100%** | **4 个协议完整覆盖** |

### 事件推送覆盖

| 协议 | WebSocket | SSE | WebHook | WS-Reverse |
|------|-----------|-----|---------|------------|
| OneBot V11 | ✅ | ❌ | ✅ | ✅ |
| OneBot V12 | ✅ | ❌ | ❌ | ✅ |
| Milky V1 | ✅ | ✅ | ✅ | ❌ |
| Satori V1 | ✅ | ❌ | ❌ | ❌ |

## 📚 参考文档

- [OneBot 11 标准](https://github.com/botuniverse/onebot-11)
- [OneBot 12 标准](https://12.onebot.dev/)
- [Vitest 文档](https://vitest.dev/)

## ✨ 测试输出优化

### 问题
之前使用 `console.warn()` 输出不支持的 API 警告，导致：
- ⚠️ 警告信息被大量测试输出淹没
- ⚠️ 难以看到完整的不支持 API 列表  
- ⚠️ 警告信息分散在整个测试输出中

### 解决方案
采用 **警告收集机制**，在测试结束后统一显示汇总：

```javascript
// 收集阶段
const unsupportedApis = [];

test('api_name', async () => {
  if (data.status === 'failed') {
    unsupportedApis.push('api_name - API 描述');
  }
});

// 汇总显示
afterAll(() => {
  if (unsupportedApis.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('📋 不支持的 API 汇总 (共 ' + unsupportedApis.length + ' 个)');
    console.log('='.repeat(70));
    unsupportedApis.forEach((api, index) => {
      console.log(`  ${(index + 1).toString().padStart(2, ' ')}. ${api}`);
    });
    console.log('='.repeat(70) + '\n');
  } else {
    console.log('\n✅ 所有测试的 API 均已支持！\n');
  }
});
```

### 效果对比

**优化前**：
```
stderr | test.spec.js > API > send_private_msg
⚠️  send_private_msg 不支持
[大量其他输出...]
stderr | test.spec.js > API > get_group_list
⚠️  get_group_list 不支持
```

**优化后**：
```
✓ __tests__/onebot/v11/http/api.spec.js (36)

======================================================================
📋 OneBot V11 不支持的 API 汇总 (共 30 个)
======================================================================
   1. send_private_msg - 发送私聊消息
   2. send_group_msg - 发送群消息
   3. get_group_list - 获取群列表
  ...
  30. set_restart - 重启 OneBot 实现
======================================================================
```
