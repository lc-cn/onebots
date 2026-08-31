# 中间件系统

OneBots 核心包提供了完整的中间件系统，包括安全性、性能和监控功能。

## 可用中间件

### 1. 速率限制 (Rate Limiting)

防止 API 滥用，保护服务器资源。

```typescript
import { createRateLimit, defaultRateLimit } from '@onebots/core';

// 使用默认配置（1分钟100次请求）
app.use(defaultRateLimit);

// 自定义配置
const customRateLimit = createRateLimit({
    windowMs: 60 * 1000, // 1分钟
    max: 50, // 最多50次请求
    message: '请求过于频繁，请稍后再试',
});
app.use(customRateLimit);
```

### 2. 安全审计日志 (Security Audit)

记录所有安全相关事件，包括认证失败、无效令牌、可疑请求等。

```typescript
import { initSecurityAudit, securityAudit } from '@onebots/core';

// 初始化（在 BaseApp 中自动完成）
initSecurityAudit('/path/to/audit/logs');

// 使用中间件（在 BaseApp 中自动完成）
app.use(securityAudit());

// 手动记录事件
import { logAuthFailure, logInvalidToken, logSuspiciousRequest } from '@onebots/core';
logAuthFailure(ctx, 'Invalid credentials');
logInvalidToken(ctx, token);
logSuspiciousRequest(ctx, 'Unusual request pattern', { details });
```

### 3. 令牌验证 (Token Validation)

支持多种令牌验证方式。

```typescript
import { 
    createTokenValidator, 
    createConfigTokenValidator,
    createHMACValidator,
    createManagedTokenValidator,
} from '@onebots/core';

// 基础令牌验证
const tokenValidator = createTokenValidator({
    tokenName: 'access_token',
    fromHeader: true,
    fromQuery: true,
    required: true,
});

// 基于配置的验证
const configValidator = createConfigTokenValidator(['token1', 'token2']);

// HMAC 签名验证
const hmacValidator = createHMACValidator('your-secret-key', 'sha256');

// 带令牌管理的验证（支持过期和刷新）
import { initTokenManager } from '@onebots/core';
const tokenManager = initTokenManager({
    defaultExpiration: 3600000, // 1小时
    autoRefresh: true,
});
const managedValidator = createManagedTokenValidator(tokenManager);
```

### 4. 性能指标收集 (Metrics Collection)

自动收集请求数、响应时间、错误率等指标。

```typescript
import { metricsCollector, metrics } from '@onebots/core';

// 使用中间件（在 BaseApp 中自动完成）
app.use(metricsCollector());

// 访问指标
const requestCount = metrics.getLatestValue('http_requests_total', { method: 'GET' });
const avgResponseTime = metrics.getAverage('http_request_duration_ms', {}, 60000); // 最近1分钟
const errorRate = metrics.getSum('http_errors_total', {}, 60000);

// 导出 Prometheus 格式
const prometheusMetrics = metrics.exportPrometheus();
```

## 在 BaseApp 中的自动集成

所有中间件已在 `BaseApp` 中自动集成：

1. **性能指标收集** - 最早执行，记录所有请求
2. **安全审计日志** - 记录所有安全事件
3. **速率限制** - 防止 API 滥用
4. **认证中间件** - Basic Auth 或协议路径验证

## 健康检查端点

BaseApp 自动提供以下端点：

- `/health` - 基础健康检查（存活探针）
- `/ready` - 就绪检查（就绪探针）
- `/metrics` - Prometheus 格式指标

## 使用示例

```typescript
import { App } from 'onebots';

const app = new App({
    port: 6727,
    log_level: 'info',
});

// 所有中间件已自动配置
await app.start();

// 访问健康检查
// GET http://localhost:6727/health
// GET http://localhost:6727/ready
// GET http://localhost:6727/metrics
```

## 安全审计日志位置

安全审计日志保存在：
```
{dataDir}/audit/security-audit-{date}.log
```

日志格式为 JSON Lines，每行一个事件记录。

