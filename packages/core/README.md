# @onebots/core

OneBots 核心库 - 提供多平台多协议机器人应用的基础架构。

## 简介

`@onebots/core` 是 OneBots 框架的核心包，提供了构建多平台多协议机器人应用所需的基础类和工具。它包含：

- **BaseApp**: 应用基类，提供核心功能
- **Adapter**: 适配器基类，用于连接不同平台
- **Protocol**: 协议基类，用于实现不同的通信协议
- **Account**: 账号管理
- **Registry**: 注册中心（适配器注册、协议注册）
- **Types**: 通用类型定义

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
import { BaseApp, Adapter, Protocol } from '@onebots/core';

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
    super(config);
  }
}
```

## API 文档

### BaseApp

```typescript
class BaseApp {
  constructor(config: BaseApp.Config);
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
import type { 
  Dict, 
  CommonEvent, 
  CommonTypes 
} from '@onebots/core';
```

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
- [@onebots/protocol-satori](../protocol-satori) - Satori 协议
- [@onebots/protocol-milky-v1](../protocol-milky-v1) - Milky V1 协议

## 许可证

MIT License - 查看 [LICENSE](../../LICENSE) 文件了解详情

## 作者

凉菜
