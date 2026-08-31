# 生产就绪功能

OneBots 提供了完整的生产级功能，包括安全性、稳定性和可观测性，确保系统可以在生产环境中稳定运行。

## 安全性功能

### 速率限制 (Rate Limiting)

防止 API 滥用，保护服务器资源。

**特性**:
- 基于时间窗口的速率限制
- 支持自定义键生成（默认使用 IP）
- 自动设置响应头（X-RateLimit-*）
- 集成安全审计日志

**默认配置**: 1 分钟 100 次请求

**自动启用**: 已在 `BaseApp` 中自动集成，无需额外配置

### 安全审计日志

记录所有安全相关事件，满足合规要求。

**特性**:
- 认证成功/失败记录
- 无效令牌记录
- 速率限制触发记录
- 可疑请求记录
- 错误事件记录
- JSON Lines 格式日志
- 按日期分割日志文件

**日志位置**: `{dataDir}/audit/security-audit-{date}.log`

**自动启用**: 已在 `BaseApp` 中自动集成

### 令牌管理

完整的令牌生命周期管理。

**特性**:
- 令牌生成和验证
- 令牌过期检查
- 令牌刷新机制
- 自动清理过期令牌
- 令牌撤销功能

**使用示例**:

```typescript
import { initTokenManager, createManagedTokenValidator } from '@onebots/core';

// 初始化令牌管理器
const tokenManager = initTokenManager({
    defaultExpiration: 3600000, // 1小时
    autoRefresh: true,
});

// 创建令牌验证中间件
const tokenValidator = createManagedTokenValidator(tokenManager);
```

### HMAC 签名验证

防止请求篡改和重放攻击。

**特性**:
- 支持多种 HMAC 算法（默认 SHA256）
- 时间安全比较
- 防止重放攻击

## 稳定性功能

### 熔断器模式

防止级联故障，提高系统韧性。

**特性**:
- 三种状态：关闭、开启、半开
- 基于失败次数和错误率的触发
- 自动恢复机制
- 状态监控和统计

**使用示例**:

```typescript
import { CircuitBreaker } from '@onebots/core';

const circuitBreaker = new CircuitBreaker({
    failureThreshold: 5,        // 失败阈值
    resetTimeout: 60000,        // 重置超时（60秒）
    halfOpenMaxCalls: 3,        // 半开状态最大调用数
});

// 使用熔断器执行操作
try {
    const result = await circuitBreaker.execute(async () => {
        return await externalService.call();
    });
} catch (error) {
    // 处理错误
}
```

### 重试机制

自动处理临时故障，提高成功率。

**特性**:
- 指数退避策略
- 随机抖动（防止惊群效应）
- 可配置重试次数和延迟
- 智能错误判断（只重试网络错误）

### 连接池

优化资源使用，提高性能。

**特性**:
- 连接复用
- 最大/最小连接数控制
- 空闲连接自动清理
- 连接验证
- 等待队列管理

## 可观测性

### 性能指标收集

自动收集系统性能指标。

**特性**:
- 计数器（Counter）
- 仪表（Gauge）
- 直方图（Histogram）
- 标签支持
- 时间窗口统计
- 自动清理过期数据

**自动启用**: 已在 `BaseApp` 中自动集成

### Prometheus 指标导出

标准格式的指标导出，可直接接入 Prometheus + Grafana。

**端点**: `GET /metrics`

**指标包括**:
- 应用信息（版本、运行时间）
- 内存使用（RSS、堆内存）
- 适配器和账号状态
- HTTP 请求指标（请求数、响应时间、错误率）

**使用示例**:

```bash
# 访问指标端点
curl http://localhost:6727/metrics

# 配置 Prometheus
scrape_configs:
  - job_name: 'onebots'
    static_configs:
      - targets: ['localhost:6727']
```

### 健康检查端点

支持 Kubernetes 部署的探针。

**端点**:
- `GET /health` - 存活探针（liveness probe）
- `GET /ready` - 就绪探针（readiness probe）

**功能**:
- `/health`: 基础健康检查
- `/ready`: 检查所有适配器和账号是否就绪

**Kubernetes 配置示例**:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 6727
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /ready
    port: 6727
  initialDelaySeconds: 5
  periodSeconds: 5
```

## 自动集成

所有生产就绪功能已在 `BaseApp` 中自动集成，无需额外配置即可使用。

### 自动启用的功能

1. **速率限制** - 默认 1 分钟 100 次请求
2. **安全审计日志** - 自动记录到 `{dataDir}/audit/`
3. **性能指标收集** - 自动收集所有 HTTP 请求指标
4. **健康检查端点** - `/health`, `/ready`, `/metrics`

### 可选配置

```typescript
import { App } from 'onebots';
import { initTokenManager } from '@onebots/core';

// 初始化令牌管理器（可选）
const tokenManager = initTokenManager({
    defaultExpiration: 3600000, // 1小时
    autoRefresh: true,
});

const app = new App({
    port: 6727,
    log_level: 'info',
});

await app.start();
```

## 注意事项

1. **速率限制存储**: 当前使用内存存储，生产环境建议使用 Redis
2. **安全审计日志**: 日志文件会按日期分割，建议定期归档
3. **性能指标**: 默认保留最近 1000 个样本，可根据需要调整
4. **令牌管理**: 令牌管理器需要手动初始化才能使用

## 后续优化建议

1. **Redis 支持**: 将速率限制和安全审计日志存储到 Redis
2. **分布式追踪**: 集成 OpenTelemetry 或 Jaeger
3. **告警系统**: 基于指标设置告警规则
4. **性能优化**: 添加缓存层和连接池优化

## 相关文档

- [快速开始](/guide/start)
- [配置指南](/config/global)
- [架构说明](/guide/architecture)

