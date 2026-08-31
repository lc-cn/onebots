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
- Adapter, account, and protocol outlet status
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
- `/ready`: Checks whether the server, accounts, and every protocol outlet are ready

The `/ready` summary includes account and protocol instance totals, their online or ready counts, and `accounts_without_protocols`. Each platform also reports its number of accounts without an outlet together with protocol `ready`, `unavailable`, and `total` values. An online platform account therefore cannot hide a failed protocol `start()` or a missing protocol configuration; either case returns HTTP 503. A fresh gateway with no accounts remains HTTP 200 so its management surface is reachable, but returns `configured: false`, which doctor presents as a warning.

Run `onebots doctor --json` as an automated gate after deployment or upgrades. When the configured port is reachable, doctor probes both endpoints whether the gateway runs in the foreground, in Docker, or as a managed service. A non-2xx response, invalid JSON, a health status other than `ok`, or readiness other than `true` fails the check. A failed `/ready` check includes online account and ready protocol counts together with affected platforms and accounts lacking an outlet, instead of reporting an unexplained HTTP 503. Use the `onebots_accounts_without_protocols` Prometheus metric to alert on this configuration gap.

Doctor also loads the selected plugins and validates the complete account and protocol configuration against their registered schemas. When checking a configuration that is not installed as a service, pass the same `-r` / `-p` arguments used by the run command. If a plugin entry exists but initialization fails, doctor preserves the first underlying error line, including duplicate registration conflicts and missing runtime dependencies, instead of reducing it to a generic initialization failure.

Setup, the Web console, and runtime account operations now share one atomic configuration writer. New content is fully written and synced in the configuration directory before it replaces the live file, preventing a terminated process from leaving truncated YAML. Updates keep the immediately previous version at `<config>.bak`; new files default to mode `0600`, while existing files retain their permissions. Validate a backup with `onebots doctor` before restoring it.

On POSIX systems, doctor checks the live configuration and its `.bak` separately. Mode `0600` is private. A group-readable mode such as `0640` produces a warning and is left unchanged so service-account sharing remains possible. Access for other users or modification by the group fails the check. With explicit `--fix`, doctor tightens those high-risk modes to `0600` and records `fixed` in the JSON report for deployment auditing.

A plugin counts as loaded only after its entry initializes and registers the factory and configuration schema promised by its CLI name. Doctor and every service preflight reject an importable package that skips registration, uses a mismatched identity, or registers a factory without its schema, instead of deferring that failure until startup or the Web console.

`onebots install -c config.yaml -r <adapter> -p <protocol>` performs the same plugin loading and configuration validation before writing an operating-system service definition. Import-only entries, top-level `await`, schema validation, and initialization failures therefore follow foreground startup semantics; a failed preflight leaves no service that is certain to fail at startup. A successful install still does not start the service, so you can inspect its definition before running `onebots start`.

`onebots start` and `onebots restart` also read the saved service definition, resolve plugins from its installation `workingDirectory`, and validate the current configuration again. This catches plugins or configuration that were removed or damaged after installation. A failed start preflight never asks the operating system to launch the service, and a failed restart preflight leaves the existing instance running.

After startup, `onebots status` reports both the process-manager state and the semantic results of `/health` and `/ready`. It distinguishes **running and ready**, **running but awaiting configuration**, and **running but unavailable**. An installed but stopped service or any failed probe returns exit code `1`; a missing installation returns `2`. CI/CD can therefore use `onebots status` as a lightweight deployment gate and reserve `onebots doctor --json` for full configuration and plugin diagnostics.

After its package-manager step, `onebots update` launches the updated CLI in the service `workingDirectory` and runs a connection-free preflight with the saved plugin list. It rewrites the service definition and optionally restarts only after every plugin loads and the configuration validates. A failed preflight leaves the current process running and preserves the existing service definition. Dependency files have already changed at that point, so fix the reported dependency problem or roll versions back with npm/pnpm before the next start, then rerun the preflight or update.

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
