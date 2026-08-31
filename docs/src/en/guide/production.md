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

### Management authentication boundary

`/api/*`, the root management WebSocket `/`, and the terminal WebSocket `/api/terminal` use the same dynamic authentication rules. Requests may use the top-level `access_token` or a session token issued after username/password login. WebSocket clients can send either `Authorization: Bearer <token>` or `?access_token=<token>`. Unauthorized WebSocket requests receive HTTP 401 before protocol upgrade, so they cannot establish a connection or receive `system.sync`, which contains the complete configuration.

After **Save and apply** rotates `username`, `password`, or `access_token`, HTTP login and WebSocket upgrades immediately use the new values. All existing access and refresh tokens are revoked, and connected root-management and terminal WebSockets close with a policy-violation status. Changes limited to accounts, protocols, or logging do not interrupt management sessions.

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

In `/health`, `application` and `version` identify the running `onebots` application package, while `core_version` identifies `@onebots/core` separately. `instance_id` is generated for every process start and `started_at` records that process start time, providing evidence that a new instance has taken ownership of the port. Prometheus publishes the application through `onebots_info` and Core through `onebots_core_info`. The Web **System** page also displays both values so an upgraded dependency cannot be mistaken for the running application release.

The `/ready` summary includes account and protocol instance totals, their online or ready counts, and `accounts_without_protocols`. Each platform also reports its number of accounts without an outlet together with protocol `ready`, `unavailable`, and `total` values. An online platform account therefore cannot hide a failed protocol `start()` or a missing protocol configuration; either case returns HTTP 503. The response's `config.status` and `config.in_sync` also prove that the file on disk is the active runtime version. An external edit, unreadable file, or host setting waiting for restart revokes readiness. A fresh gateway with no accounts remains HTTP 200 so its management surface is reachable, but returns `configured: false`, which doctor presents as a warning.

Run `onebots doctor -c config.yaml --json --strict` as an automated gate after deployment or upgrades. An explicit configuration path gives foreground and Docker deployments an independent configuration diagnostic; when that path is the managed service's saved configuration, doctor still verifies that the service is running. Doctor compares the application version reported by `/health` with the current CLI. A mismatch or a legacy endpoint that cannot prove its version produces a warning, which fails strict mode and reveals an updated installation that still runs an old process or a command resolving from another installation. Default mode keeps first-run states such as no configured account, no installed or running service, or an unavailable authenticated management probe as warnings; `--strict` makes any warning set JSON `ok` to `false` and return exit code `1`. When the configured port is reachable, doctor probes both endpoints. A non-2xx response, invalid JSON, a health status other than `ok`, or readiness other than `true` fails the check. A failed `/ready` check includes online account and ready protocol counts together with affected platforms and accounts lacking an outlet, instead of reporting an unexplained HTTP 503. Use the `onebots_accounts_without_protocols` Prometheus metric to alert on this configuration gap.

Account management summaries also expose `name`, `version`, `path`, and `lifecycleStatus` for every protocol outlet. The Bots page distinguishes pending, starting, ready, stopping, stopped, and failed outlets instead of allowing an online account to hide a failed protocol startup. After validating an authorized management credential, doctor reads the same protected runtime state and identifies the exact `platform.account/protocol.version`. The public `/ready` response remains aggregated by platform and does not disclose account identifiers.

The same online diagnosis verifies the management security boundary. An anonymous request to `/api/auth/me` must receive HTTP 401, and the anonymous root WebSocket must receive HTTP 401 before upgrade. Doctor then uses the configured `access_token` (including `ONEBOTS_ACCESS_TOKEN`) or username and password to confirm that authenticated HTTP and WebSocket access still work. A temporary session created by the username/password probe is logged out immediately. If a custom host keeps credentials only in memory so doctor cannot obtain them from configuration or the environment, anonymous rejection is still verified and the two authenticated probes report warnings.

Doctor also loads the selected plugins and validates the complete account and protocol configuration against their registered schemas. Every successful result includes the package name and version that actually resolved. The `plugin-selection` check records whether each category came from the CLI, configuration file, or service definition, together with the module resolution directory. Legacy configurations without `plugins` should still receive the same `-r` / `-p` arguments as the run command. If a plugin entry exists but initialization fails, doctor preserves the first underlying error line, including duplicate registration conflicts and missing runtime dependencies, instead of reducing it to a generic initialization failure.

When diagnosing an installed service, its saved definition remains the runtime contract. Passing a different explicit `-c` instead creates a standalone candidate scope: doctor uses that file's plugin defaults, does not mix in plugins from the old service, and does not mark or repair the unrelated service definition even with `--fix`. Deployment pipelines can therefore validate the next configuration before switching the service to it.

The protected `GET /api/system` response exposes `plugins`, the adapters and protocols that passed entry loading and registration contract validation in the current process, together with package names, versions, and real entry paths. The Web console shows the same inventory under **System information → Runtime plugins**. Because this evidence comes from the running process, it confirms whether an upgrade has restarted into the expected versions and distinguishes which installation supplied a same-named plugin. The initial management WebSocket `system.sync` message carries the same data.

Setup, the Web console, and runtime account operations now share one atomic configuration writer. New content is fully written and synced in the configuration directory before it replaces the live file, preventing a terminated process from leaving truncated YAML. Updates keep the immediately previous version at `<config>.bak`; new files default to mode `0600`, while existing files retain their permissions. Validate a backup with `onebots doctor` before restoring it.

Restart requests from Web **System information**, extension installation, and the management terminal now share one safety boundary. OneBots first runs plugin and configuration preflight from the service working directory. After returning the response, it calls `app.stop()` so accounts, protocols, WebSockets, and HTTP resources close in lifecycle order, then exits with the supervisor restart code. A graceful stop that exceeds 30 seconds is logged and handed to the supervisor for a forced switch instead of hanging forever. The System and Extensions pages record the previous `instance_id` and refresh only when `/health` identifies `onebots` with a different process identity. HTTP 200 by itself, the old process remaining online, or a missing identity field no longer proves restart completion.

The process keeps a one-way digest of the configuration file at startup, after every successful hot reload, and after account configuration writes. The `configState` field in the protected `GET /api/system` response and **System information → Configuration status** in the Web console expose only `in_sync`, `drifted`, or `unavailable` plus the last application time; neither the digest nor configuration content is returned. An external edit, a replaced mount, or a saved host setting that still requires a restart remains `drifted` until a successful reload or restart. The public `/ready` endpoint projects the same state and returns HTTP 503 while it is out of sync; `onebots_config_in_sync` becomes `0`, and doctor reports drift and unreadable files as distinct actionable causes. The initial management WebSocket `system.sync` message carries the same state.

On POSIX systems, doctor checks the live configuration and its `.bak` separately. Mode `0600` is private. A group-readable mode such as `0640` produces a warning and is left unchanged so service-account sharing remains possible. Access for other users or modification by the group fails the check. With explicit `--fix`, doctor tightens those high-risk modes to `0600` and records `fixed` in the JSON report for deployment auditing.

A plugin counts as loaded only after its entry initializes and registers the factory and configuration schema promised by its CLI name. Doctor and every service preflight reject an importable package that skips registration, uses a mismatched identity, or registers a factory without its schema, instead of deferring that failure until startup or the Web console.

`onebots install -c config.yaml -r <adapter> -p <protocol>` performs the same plugin loading and configuration validation before writing an operating-system service definition. Import-only entries, top-level `await`, schema validation, and initialization failures therefore follow foreground startup semantics; a failed preflight leaves no service that is certain to fail at startup. A successful install still does not start the service, so you can inspect its definition before running `onebots start`.

`onebots start` and `onebots restart` also read the saved service definition, resolve plugins from its installation `workingDirectory`, and validate the current configuration again. This catches plugins or configuration that were removed or damaged after installation. A failed start preflight never asks the operating system to launch the service, and a failed restart preflight leaves the existing instance running. After the operating-system command returns, the CLI polls `/health` and `/ready` for a bounded period. The online application and version must match the current CLI, readiness must succeed or remain in the configurable first-run state, and the health endpoint must provide a valid `instance_id`. `start` remains idempotent for an already-online service. When the service was stopped but its port was occupied, and whenever `restart` runs, the verified instance identity must differ from the one observed before the operation. If the previous process still owns the port, the target process never comes online, or identity evidence is absent, the command fails with its final probe evidence instead of reporting a premature success.

After startup, `onebots status` reports both the process-manager state and the semantic results of `/health` and `/ready`. It distinguishes **running and ready**, **running but awaiting configuration**, **running with an unverified version**, and **running but unavailable**. A missing or mismatched online application version, an installed but stopped service, or any failed probe returns exit code `1`; a missing installation returns `2`. A first-run gateway with no accounts remains **awaiting configuration** and exits successfully so its management surface stays usable. CI/CD can therefore use `onebots status` as a lightweight deployment gate and reserve `onebots doctor --json --strict` for full configuration and plugin diagnostics.

During configuration reloads, the HTTP liveness probe remains successful while `/ready` immediately returns HTTP 503 with `reloading: true` until the new accounts and protocol outlets finish starting or the previous configuration is restored. Concurrent reloads are rejected to prevent interleaved configuration changes. Prometheus exposes `onebots_reloading` for alerting on unusually long reloads. The Web console's **Save and apply** action atomically writes the file before hot reloading. A runtime failure restores both disk and runtime state, while host-setting changes return the fields that require a process restart.

By default, `onebots update` reads the current `config.yaml` `plugins` selection, so adapters and protocols added later through the Web extension center are included in version checks and updates. Explicit `-r` and `-p` values still override their respective categories; only legacy configurations without `plugins` fall back to the service installation snapshot. A successful package-manager exit is not accepted as proof by itself. The updater reads package manifests from the project runtime, falling back to the current OneBots installation root for a global CLI, and compares the actual version of the application and every selected plugin with the queried target. Any missing or mismatched package reports the complete expected/actual evidence and stops before service preflight, definition changes, or restart. Once every installed version is proven, `onebots update` launches the updated CLI in the service `workingDirectory` and runs a connection-free preflight with that same plugin list. It rewrites the service definition and optionally restarts only after every plugin loads and the configuration validates. After a restart, the command polls `/health` and `/ready` for a bounded period. Completion requires the online process to declare the `onebots` application identity, target version, and a valid `instance_id` different from the one observed before restart, while readiness must succeed or remain in the first-run state that still permits configuration. A timeout preserves the final health and readiness evidence and points to `onebots status` and the service logs. Deferring an interactive restart now explicitly says that the updated packages are still served by the old process. A failed preflight leaves the current process running and preserves the existing service definition. Dependency files have already changed at that point, so fix the reported dependency problem or roll versions back with npm/pnpm before the next start, then rerun the preflight or update.

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
