# Production-Ready Features

OneBots provides complete production-grade features including security, stability, and observability to ensure the system can run stably in production environments.

## Security Features

### Rate Limiting

Prevents API abuse and protects server resources.

**Features**:
- Time-window based rate limiting
- Custom key generation support (default uses IP)
- Automatic response headers (X-RateLimit-*)
- Integrated security audit logging

**Default Configuration**: 100 requests per minute

**Auto-Enabled**: Automatically integrated in `BaseApp`, no additional configuration needed

### Security Audit Logging

Records all security-related events to meet compliance requirements.

**Features**:
- Authentication success/failure records
- Invalid token records
- Rate limit trigger records
- Suspicious request records
- Error event records
- JSON Lines format logs
- Date-split log files

**Log Location**: `{dataDir}/audit/security-audit-{date}.log`

**Auto-Enabled**: Automatically integrated in `BaseApp`

### Token Management

Complete token lifecycle management.

**Features**:
- Token generation and validation
- Token expiration checking
- Token refresh mechanism
- Automatic cleanup of expired tokens
- Token revocation

**Usage Example**:

```typescript
import { initTokenManager, createManagedTokenValidator } from '@onebots/core';

// Initialize token manager
const tokenManager = initTokenManager({
    defaultExpiration: 3600000, // 1 hour
    autoRefresh: true,
});

// Create token validation middleware
const tokenValidator = createManagedTokenValidator(tokenManager);
```

### HMAC Signature Validation

Prevents request tampering and replay attacks.

**Features**:
- Support for multiple HMAC algorithms (default SHA256)
- Time-safe comparison
- Replay attack prevention

## Stability Features

### Circuit Breaker Pattern

Prevents cascading failures and improves system resilience.

**Features**:
- Three states: Closed, Open, Half-Open
- Trigger based on failure count and error rate
- Automatic recovery mechanism
- State monitoring and statistics

**Usage Example**:

```typescript
import { CircuitBreaker } from '@onebots/core';

const circuitBreaker = new CircuitBreaker({
    failureThreshold: 5,        // Failure threshold
    resetTimeout: 60000,        // Reset timeout (60 seconds)
    halfOpenMaxCalls: 3,        // Max calls in half-open state
});

// Execute operation with circuit breaker
try {
    const result = await circuitBreaker.execute(async () => {
        return await externalService.call();
    });
} catch (error) {
    // Handle error
}
```

### Retry Mechanism

Automatically handles temporary failures to improve success rate.

**Features**:
- Exponential backoff strategy
- Random jitter (prevents thundering herd)
- Configurable retry count and delay
- Smart error judgment (only retries network errors)

### Connection Pool

Optimizes resource usage and improves performance.

**Features**:
- Connection reuse
- Max/min connection count control
- Automatic cleanup of idle connections
- Connection validation
- Wait queue management

## Observability

### Performance Metrics Collection

Automatically collects system performance metrics.

**Features**:
- Counter
- Gauge
- Histogram
- Label support
- Time window statistics
- Automatic cleanup of expired data

**Auto-Enabled**: Automatically integrated in `BaseApp`

### Prometheus Metrics Export

Standard format metrics export, can be directly integrated with Prometheus + Grafana.

**Endpoint**: `GET /metrics`

**Metrics Include**:
- Application information (version, uptime)
- Memory usage (RSS, heap memory)
- Adapter and account status
- HTTP request metrics (request count, response time, error rate)

**Usage Example**:

```bash
# Access metrics endpoint
curl http://localhost:6727/metrics

# Configure Prometheus
scrape_configs:
  - job_name: 'onebots'
    static_configs:
      - targets: ['localhost:6727']
```

### Health Check Endpoints

Supports Kubernetes deployment probes.

**Endpoints**:
- `GET /health` - Liveness probe
- `GET /ready` - Readiness probe

**Features**:
- `/health`: Basic health check
- `/ready`: Checks if all adapters and accounts are ready

**Kubernetes Configuration Example**:

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

## Auto Integration

All production-ready features are automatically integrated in `BaseApp`, ready to use without additional configuration.

### Auto-Enabled Features

1. **Rate Limiting** - Default 100 requests per minute
2. **Security Audit Logging** - Automatically logs to `{dataDir}/audit/`
3. **Performance Metrics Collection** - Automatically collects all HTTP request metrics
4. **Health Check Endpoints** - `/health`, `/ready`, `/metrics`

### Optional Configuration

```typescript
import { App } from 'onebots';
import { initTokenManager } from '@onebots/core';

// Initialize token manager (optional)
const tokenManager = initTokenManager({
    defaultExpiration: 3600000, // 1 hour
    autoRefresh: true,
});

const app = new App({
    port: 6727,
    log_level: 'info',
});

await app.start();
```

## Notes

1. **Rate Limiting Storage**: Currently uses in-memory storage, production environments should use Redis
2. **Security Audit Logs**: Log files are split by date, recommend regular archiving
3. **Performance Metrics**: Default retains last 1000 samples, can be adjusted as needed
4. **Token Management**: Token manager needs manual initialization to use

## Future Optimization Suggestions

1. **Redis Support**: Store rate limiting and security audit logs in Redis
2. **Distributed Tracing**: Integrate OpenTelemetry or Jaeger
3. **Alerting System**: Set up alert rules based on metrics
4. **Performance Optimization**: Add cache layer and connection pool optimization

## Related Documentation

- [Quick Start](/en/guide/start)
- [Configuration Guide](/en/config/global)
- [Architecture](/en/guide/architecture)

