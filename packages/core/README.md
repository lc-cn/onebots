# @onebots/core

onebots 核心库 - 提供多平台多协议机器人应用的基础架构。

## 简介

`@onebots/core` 是 onebots 框架的核心包，提供了构建多平台多协议机器人应用所需的基础类和工具。它包含：

- **BaseApp**: 应用基类，提供核心功能
- **Adapter**: 适配器基类，用于连接不同平台
- **Protocol**: 协议基类，用于实现不同的通信协议
- **Account**: 账号管理
- **Registry**: 注册中心（适配器注册、协议注册）
- **Types**: 通用类型定义
- **Async utilities**: 代次安全的可刷新值缓存与有序受控并发
- **API path**: 供适配器复用的结构化 API 路径安全校验
- **JSON fingerprint**: 与对象键构造顺序无关的事件载荷序列化和 SHA-256 指纹

## 特性

- 🎯 **纯库设计** - 只包含基础类和类型，不包含应用逻辑
- 📦 **模块化架构** - 清晰的模块划分，易于扩展
- 🔌 **插件系统** - 支持动态注册适配器和协议
- 🏗️ **TypeScript** - 完整的类型支持
- 🔄 **事件驱动** - 基于事件的通信机制

## 安装

```bash
npm install @onebots/core
# 或
pnpm add @onebots/core
```

## 核心概念

### BaseApp

应用基类，提供：

- 配置管理
- 适配器管理
- 账号管理
- HTTP 服务器
- 事件系统

### Adapter

适配器基类，用于：

- 连接特定平台（微信、QQ、钉钉等）
- 管理账号
- 转换平台事件为通用格式

### Protocol

协议基类，用于：

- 实现通信协议（OneBot v11/v12、Satori、Milky 等）
- 处理 API 调用
- 分发事件

### Registry

注册中心：

- `AdapterRegistry`: 管理适配器注册
- `ProtocolRegistry`: 管理协议注册

## 使用示例

```typescript
import { BaseApp, Adapter, Protocol } from "@onebots/core";

// 创建自定义适配器
class MyAdapter extends Adapter {
  async start() {
    // 实现适配器启动逻辑
  }
}

// 创建自定义协议
class MyProtocol extends Protocol {
  async apply(action: string, params: any) {
    // 实现 API 调用逻辑
  }

  dispatch(event: any) {
    // 实现事件分发逻辑
  }
}

// 使用基类
class MyApp extends BaseApp {
  constructor(config) {
    super(config, { name: "my-gateway", version: "1.0.0" });
  }
}
```

第二个参数是嵌入式应用的生产身份。`/health`、`onebots_info` 与 `app.info` 会使用该应用名称和版本，同时通过 `core_version` / `onebots_core_info` 单独公开 `@onebots/core` 版本。省略时应用身份默认为当前 Core 包；自定义网关应传入自身包身份，便于部署系统证明实际运行版本。

## API 文档

### BaseApp

```typescript
class BaseApp {
  constructor(config: BaseApp.Config, identity?: { name: string; version: string });
  start(): Promise<void>;
  stop(force?: boolean): Promise<void>;
  // ... 更多方法
}
```

### Adapter

```typescript
abstract class Adapter {
  constructor(app: BaseApp, platform: string, config: any);
  abstract start(): Promise<void>;
  stop(force?: boolean): Promise<void>;
  // ... 更多方法
}
```

### Protocol

```typescript
abstract class Protocol {
  constructor(adapter: Adapter, account: Account, config: any);
  abstract apply(action: string, params?: any): Promise<any>;
  abstract dispatch(event: any): void;
  // ... 更多方法
}
```

## 类型系统

核心包提供了完整的类型定义：

```typescript
import type { Dict, CommonEvent, CommonTypes } from "@onebots/core";
```

## 确定性事件指纹

平台没有提供原生事件 ID 时，可先选出真正构成事件身份的公开字段，再生成稳定指纹：

```typescript
import { sha256Json, stableJsonStringify } from "@onebots/core";

const identity = `sha256:${sha256Json({ event: rawEvent.event, header: rawEvent.header })}`;
const canonicalPayload = stableJsonStringify(rawEvent);
```

`stableJsonStringify()` 会递归排序对象键、保留数组顺序，并拒绝循环引用。不要把随机数或当前时间混入重试事件的身份。

## 可靠事件派发

`Account.dispatch(event)` 保留 fire-and-forget 语义，适用于不需要把投递结果反馈给上游的内部事件。Webhook、队列和 Stream 等需要“处理成功后再确认”的入口应使用：

```typescript
await account.dispatchAwaited(event);
```

`dispatchAwaited()` 会让全部已绑定协议都获得一次投递机会，等待异步 `Protocol.dispatch()` 完成，并在任一协议失败时向调用方传播错误。接入层可据此返回失败响应或请求平台重投。

`Account.start()` 会等待账号的异步启动监听器完成后再启动协议，启动错误直接向调用方传播。`Account.stop()` 即使遇到单个协议停止失败，也会继续停止其余协议和账号客户端，清理监听器后再汇总错误。

需要执行多步关闭或回滚时可使用 `FailureCollector`：`capture()` 会保留错误并继续后续步骤，`throwIfAny()` 在清理完成后传播单个原始错误或多个错误的 `AggregateError`，避免底层记录日志后误报正常关闭。

无法等待异步 handler 的 Gateway/EventEmitter 可使用 `OrderedEventDeliveryQueue` 把事件串行交给 `account.dispatchAwaited()`。队列会在当前事件完整成功前阻止后续事件越过，按封顶退避持续重试，并在停止时取消当前代次；它不会用硬上限静默丢弃已经被上游提交游标的事件。

## 开发

```bash
# 构建
pnpm build

# 测试
pnpm test

# 运行测试（单次）
pnpm test:run
```

## 相关包

- [onebots](../onebots) - 主应用包
- [@onebots/adapter-wechat](../adapter-wechat) - 微信适配器
- [@onebots/protocol-onebot-v11](../protocol-onebot-v11) - OneBot V11 协议
- [@onebots/protocol-onebot-v12](../protocol-onebot-v12) - OneBot V12 协议
- [@onebots/protocol-satori-v1](../protocol-satori) - Satori 协议
- [@onebots/protocol-milky-v1](../protocol-milky-v1) - Milky V1 协议

## 许可证

MIT License - 查看 [LICENSE](../../LICENSE) 文件了解详情

## 作者

凉菜
