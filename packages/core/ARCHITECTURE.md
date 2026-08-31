# Core Package Architecture

## 新增功能模块

### 1. 错误处理系统 (`errors.ts`)

提供统一的错误分类和处理机制。

#### 错误分类

- `NETWORK`: 网络相关错误
- `CONFIG`: 配置相关错误
- `RUNTIME`: 运行时错误
- `VALIDATION`: 验证错误
- `RESOURCE`: 资源错误
- `PROTOCOL`: 协议错误
- `ADAPTER`: 适配器错误

#### 使用示例

```typescript
import { NetworkError, ErrorHandler, ErrorCategory } from '@onebots/core';

// 创建特定类型的错误
const error = new NetworkError('Connection failed', {
    context: { url: 'http://example.com' }
});

// 包装未知错误
try {
    // some code
} catch (e) {
    const wrapped = ErrorHandler.wrap(e, { context: 'additional info' });
    // 处理错误
}

// 检查错误是否可恢复
if (ErrorHandler.isRecoverable(error)) {
    // 尝试恢复
}
```

### 2. 增强日志系统 (`logger.ts`)

提供结构化日志、错误追踪和上下文信息。

#### 使用示例

```typescript
import { createLogger } from '@onebots/core';

const logger = createLogger('MyModule');

// 基本日志
logger.info('Application started');
logger.error('Something went wrong');

// 带上下文的日志
logger.info('User logged in', { userId: '123', ip: '192.168.1.1' });

// 性能测量
const stopTimer = logger.start('database-query');
// ... 执行操作
stopTimer(); // 自动记录耗时

// 或手动记录
logger.performance('database-query', 150);

// 带上下文的 Logger
const contextLogger = logger.withContext({ requestId: 'abc123' });
contextLogger.info('Processing request'); // 自动包含 requestId
```

### 3. 配置验证系统 (`config-validator.ts`)

提供配置schema验证和默认值处理。

#### 使用示例

```typescript
import { ConfigValidator, BaseAppConfigSchema } from '@onebots/core';

// 验证配置
const config = {
    port: 8080,
    // 其他配置...
};

const validated = ConfigValidator.validateWithDefaults(config, BaseAppConfigSchema);

// 自定义 Schema
const customSchema = {
    port: {
        type: 'number',
        min: 1,
        max: 65535,
        default: 8080,
    },
    host: {
        type: 'string',
        required: true,
    },
    ssl: {
        type: 'boolean',
        default: false,
    },
};

const validated = ConfigValidator.validate(config, customSchema);
```

### 4. 依赖注入容器 (`di-container.ts`)

提供依赖注入和生命周期管理。

#### 使用示例

```typescript
import { Container, container } from '@onebots/core';

// 注册服务
class Database {
    connect() {
        return 'connected';
    }
}

class UserService {
    constructor(private db: Database) {}
    
    getUser(id: string) {
        return this.db.query(`SELECT * FROM users WHERE id = ${id}`);
    }
}

// 注册单例
container.registerSingleton('Database', Database);
container.registerSingleton('UserService', UserService, ['Database']);

// 获取服务
const userService = container.get<UserService>('UserService');
```

### 5. 生命周期管理 (`lifecycle.ts`)

提供资源管理和优雅关闭机制。

#### 使用示例

```typescript
import { LifecycleManager } from '@onebots/core';

const lifecycle = new LifecycleManager();

// 注册资源
lifecycle.register('database', async () => {
    await db.close();
});

lifecycle.register('httpServer', () => {
    return new Promise(resolve => {
        server.close(() => resolve());
    });
});

// 添加生命周期钩子
lifecycle.addHook({
    onInit: async () => {
        console.log('Initializing...');
    },
    onStart: async () => {
        console.log('Starting...');
    },
    onStop: async () => {
        console.log('Stopping...');
    },
    onCleanup: async () => {
        console.log('Cleaning up...');
    },
});

// 执行生命周期
await lifecycle.init();
await lifecycle.start();

// 优雅关闭
process.on('SIGTERM', async () => {
    await lifecycle.gracefulShutdown('SIGTERM');
});
```

## BaseApp 集成

所有新功能都已集成到 `BaseApp` 中：

```typescript
import { BaseApp } from '@onebots/core';

const app = new BaseApp({
    port: 8080,
    // 配置会自动验证并应用默认值
});

// 使用增强日志
app.enhancedLogger.info('Application started');

// 生命周期管理已自动集成
// 在 stop() 时会自动清理所有资源

// 错误处理已集成
// 所有错误都会被正确分类和记录
```

## 测试

所有模块都包含完整的单元测试：

```bash
# 运行测试
pnpm test -- packages/core

# 查看覆盖率
pnpm test -- packages/core --coverage
```

## 最佳实践

1. **错误处理**: 始终使用 `ErrorHandler.wrap()` 包装未知错误
2. **日志记录**: 使用增强日志系统记录结构化信息
3. **配置验证**: 在应用启动时验证所有配置
4. **资源管理**: 使用生命周期管理器注册所有资源
5. **依赖注入**: 使用 DI 容器管理服务依赖

