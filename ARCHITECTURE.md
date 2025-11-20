# OneBots 架构文档 (Architecture Documentation)

## 概述

OneBots 是一个多协议、多平台的机器人应用启动器，支持 QQ、微信、钉钉等多个平台，并可扩展支持多种通信协议（OneBot、Milky、Satori 等）。

## 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    OneBots Application                   │
├─────────────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌───────────┐           │
│  │  HTTP API │  │ WebSocket │  │  Web UI   │           │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘           │
│        │              │              │                   │
│  ┌─────┴──────────────┴──────────────┴─────┐           │
│  │           Router & Middleware             │           │
│  └─────────────────┬───────────────────────┘           │
│                    │                                     │
│  ┌─────────────────┴───────────────────────┐           │
│  │          Protocol Registry               │           │
│  │  ┌─────────────────────────────────┐   │           │
│  │  │  OneBot  │  Milky  │  Satori    │   │           │
│  │  │  ┌────┐  │  ┌────┐ │  ┌────┐   │   │           │
│  │  │  │ v11│  │  │ v1 │ │  │ v1 │   │   │           │
│  │  │  │ v12│  │  └────┘ │  └────┘   │   │           │
│  │  │  └────┘  │         │            │   │           │
│  │  └─────────────────────────────────┘   │           │
│  └─────────────────┬───────────────────────┘           │
│                    │                                     │
│  ┌─────────────────┴───────────────────────┐           │
│  │          Platform Adapters                │           │
│  │  ┌──────┐ ┌────────┐ ┌────────┐ ┌──────┐│           │
│  │  │ ICQQ │ │   QQ   │ │ WeChat │ │ DingD││           │
│  │  └──┬───┘ └───┬────┘ └───┬────┘ └──┬───┘│           │
│  └─────┼─────────┼──────────┼─────────┼────┘           │
│        │         │          │         │                 │
│  ┌─────┴─────────┴──────────┴─────────┴────┐           │
│  │            SQLite Database                │           │
│  └───────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. Application Layer (应用层)

#### App
- **位置**: `src/server/app.ts`
- **职责**:
  - HTTP 服务器管理
  - 路由配置
  - 适配器生命周期管理
  - 配置文件加载和保存

#### Router
- **位置**: `src/server/router.ts`
- **职责**:
  - HTTP 路由处理
  - WebSocket 升级管理
  - 多路由栈管理

### 2. Protocol Layer (协议层)

#### Protocol (基类)
- **位置**: `src/protocols/base.ts`
- **职责**:
  - 定义协议标准接口
  - 提供通用协议功能
  - 事件过滤
  - 消息格式化

#### ProtocolRegistry
- **位置**: `src/protocols/registry.ts`
- **职责**:
  - 协议注册和管理
  - 协议实例化
  - 协议元数据查询

#### OneBot Protocol
- **位置**: `src/protocols/onebot/`
- **实现**:
  - `v11.ts`: OneBot V11 协议
  - `v12.ts`: OneBot V12 协议
- **职责**:
  - 实现 OneBot 标准
  - HTTP/WebSocket 服务
  - 事件上报
  - API 调用

### 3. Adapter Layer (适配器层)

#### Adapter (基类)
- **位置**: `src/adapter.ts`
- **职责**:
  - 管理平台机器人实例
  - 消息格式转换
  - 事件分发
  - API 调用路由

#### Platform Adapters
- **ICQQ**: `src/adapters/icqq/` - QQ 协议实现
- **QQ Official**: `src/adapters/qq/` - QQ 官方机器人
- **WeChat**: `src/adapters/wechat/` - 微信协议实现
- **DingTalk**: `src/adapters/dingtalk/` - 钉钉机器人

### 4. Data Layer (数据层)

#### SqliteDB
- **位置**: `src/sqlite-db.ts`
- **职责**:
  - 键值存储
  - 数据持久化
  - 数组操作
  - 查询过滤

#### JsonDB (废弃)
- **位置**: `src/db.ts`
- **状态**: 已废弃，保留用于向后兼容

### 5. Utility Layer (工具层)

#### AdapterUtils
- **位置**: `src/adapter-utils.ts`
- **功能**:
  - 消息 ID 转换
  - 包版本检测
  - 事件处理器管理
  - 复合 ID 操作

#### MessageUtils
- **位置**: `src/message-utils.ts`
- **功能**:
  - 消息格式化
  - 事件载荷处理
  - 纯文本提取
  - 事件创建辅助

## URL 路由结构

### 路由格式

```
/{platform}/{uin}/{protocol}/{version}/{action}
```

**参数说明:**
- `platform`: 平台名称 (icqq, qq, wechat, dingtalk)
- `uin`: 机器人唯一标识符
- `protocol`: 协议名称 (onebot, milky, satori)
- `version`: 协议版本 (v11, v12)
- `action`: API 动作 (可选)

**示例:**
```
/icqq/123456/onebot/v11/send_private_msg
/qq/appid123/onebot/v12/get_group_list
/wechat/bot1/onebot/v11/send_group_msg
```

### 向后兼容

旧格式仍然支持：
```
/{platform}/{uin}/{version}/{action}
```

**示例:**
```
/icqq/123456/V11/send_private_msg
```

## 数据流

### 接收消息流程

```
平台客户端 → Adapter
    ↓
事件格式化 (formatEventPayload)
    ↓
OneBot 实例 (dispatch)
    ↓
Protocol 服务 (V11/V12)
    ↓
事件过滤 (filterFn)
    ↓
消息格式化 (format)
    ↓
上报分发 (dispatch)
    ↓
├─ HTTP POST
├─ WebSocket
└─ 反向连接
```

### 发送消息流程

```
API 请求 → Router
    ↓
Protocol 服务 (V11/V12)
    ↓
apply() 方法
    ↓
Adapter.call()
    ↓
平台特定方法 (sendPrivateMessage/sendGroupMessage)
    ↓
消息格式转换 (fromSegment)
    ↓
平台客户端发送
    ↓
返回消息 ID
```

## 配置结构

### 配置文件 (config.yaml)

```yaml
port: 6727                 # HTTP 服务端口
log_level: info           # 日志级别
username: admin           # Web UI 用户名
password: password        # Web UI 密码

general:                  # 通用配置
  V11:                    # OneBot V11 配置
    heartbeat: 3
    access_token: ""
    # ... 其他配置
  V12:                    # OneBot V12 配置
    heartbeat: 3
    access_token: ""
    # ... 其他配置
  protocol:               # 平台协议配置
    platform: 2
    # ... 其他配置

# 单个机器人配置
icqq.123456789:
  password: ""
  versions:
    - version: V11
  protocol:
    platform: 2
    # ... icqq 特定配置

qq.appid:
  versions:
    - version: V11
    - version: V12
  protocol:
    token: ""
    secret: ""
    # ... qq 官方机器人配置
```

## 扩展新协议

### 步骤

1. **创建协议实现**

```typescript
// src/protocols/milky/v1.ts
import { Protocol } from "../base";

export class MilkyV1Protocol extends Protocol<"v1"> {
    public readonly name = "milky";
    public readonly version = "v1";

    filterFn(event: Dict): boolean {
        // 实现事件过滤逻辑
    }

    start(): void {
        // 启动协议服务
    }

    stop(): void {
        // 停止协议服务
    }

    dispatch(event: any): void {
        // 分发事件
    }

    format(event: string, payload: any): any {
        // 格式化事件数据
    }

    async apply(action: string, params?: any): Promise<any> {
        // 执行 API 调用
    }
}
```

2. **注册协议**

```typescript
// src/protocols/milky/index.ts
import { ProtocolRegistry } from "../registry";
import { MilkyV1Protocol } from "./v1";

ProtocolRegistry.register("milky", "v1", MilkyV1Protocol, {
    displayName: "Milky V1",
    description: "Milky 协议 V1 版本",
});

export * from "./v1";
```

3. **导出协议**

```typescript
// src/protocols/index.ts
export * from "./base";
export * from "./registry";
export * from "./onebot";
export * from "./milky";  // 新增
```

### 使用新协议

```yaml
# config.yaml
icqq.123456789:
  versions:
    - version: v1
      protocol: milky  # 指定使用 milky 协议
  protocol:
    # ... milky 特定配置
```

访问 URL:
```
http://127.0.0.1:6727/icqq/123456789/milky/v1/send_message
```

## 扩展新平台

### 步骤

1. **创建适配器类**

```typescript
// src/adapters/telegram/index.ts
import { Adapter } from "@/adapter";

export default class TelegramAdapter extends Adapter<"telegram"> {
    constructor(app: App, config: TelegramAdapter.Config) {
        super(app, "telegram", config);
        this.icon = "telegram_icon_url";
    }

    // 实现必要的抽象方法
    async setOnline(uin: string) { /* ... */ }
    async setOffline(uin: string) { /* ... */ }
    
    toSegment(version, message) { /* ... */ }
    fromSegment(onebot, version, segment) { /* ... */ }
    
    // ... 其他方法
}
```

2. **注册适配器**

```typescript
// src/bin.ts 或启动文件
App.registerAdapter("telegram");
```

3. **配置适配器**

```yaml
# config.yaml
telegram.bot_token:
  versions:
    - version: V11
  protocol:
    api_server: "https://api.telegram.org"
    # ... telegram 特定配置
```

## 性能优化

### SQLite 优化
- 使用索引加速查询
- 批量操作减少写入次数
- 适当的缓存策略

### 事件处理优化
- 异步事件分发
- 事件过滤减少无效处理
- WebSocket 连接池管理

### 内存管理
- 及时清理过期数据
- 控制历史消息缓存大小
- 使用 WeakMap 管理临时数据

## 安全考虑

### 认证机制
- HTTP Basic Auth 保护 Web UI
- Access Token 保护 API 访问
- WebSocket 连接验证

### 数据安全
- 密码不记录日志
- 敏感配置加密存储
- SQLite 文件权限控制

## 测试策略

### 单元测试
- Protocol 实现测试
- Adapter 功能测试
- 工具函数测试

### 集成测试
- 端到端消息流测试
- 多协议兼容性测试
- 并发性能测试

## 部署建议

### 生产环境
- 使用进程管理器（PM2、systemd）
- 配置日志轮转
- 监控内存和 CPU 使用
- 定期备份数据库

### 开发环境
- 使用 ts-node-dev 热重载
- 启用详细日志
- 使用测试配置

---

维护者：凉菜 (lc-cn)
最后更新：2025-11-20
