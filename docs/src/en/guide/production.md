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

Invalid-token audits and token creation, refresh, and revocation logs never retain token plaintext or plaintext prefixes. When events from the same process need correlation, logs contain only a 16-character HMAC fingerprint produced with a random process key. The key is never persisted, so fingerprints change after restart. This value is diagnostic correlation only and is not token identity or authentication evidence.

### Management authentication boundary

`/api/*`, the root management WebSocket `/`, and the terminal WebSocket `/api/terminal` use the same dynamic authentication material. Ordinary management HTTP accepts credentials only from `Authorization: Bearer <token>`. `/api/auth/login` may receive the top-level `access_token` in its JSON body or exchange username and password for a session token. Log, account-verification, and message-debug SSE now use an authorized Fetch stream, keeping long-lived tokens out of URLs while one client handles framing, cancellation, and bounded reconnects. Only browser WebSocket handshakes accept either `Authorization` or `?access_token=<token>`, because the native WebSocket API cannot set request headers. Unauthorized WebSocket requests receive HTTP 401 before protocol upgrade, so they cannot establish a connection or receive `system.sync`, which contains the complete configuration.

The Web entry still accepts `?access_token=` for guided login, but it validates the candidate through the login endpoint before committing it to local session state. An invalid link cannot overwrite an existing token: an existing session continues, while a signed-out browser returns to the login page with an explicit credential error. Login, link validation, token refresh, and explicit logout each have a five-second request boundary. Timeouts, network unavailability, caller cancellation, and rejected credentials retain distinct semantics, so a slow proxy cannot leave route navigation, the login button, or logout pending forever. Logout clears browser-local credentials even when the server is unreachable; the server-side session expires naturally if the revocation request could not reach it. Every link-validation outcome removes the token from the address bar before the next navigation. The management HTML also uses both a `Referrer-Policy: no-referrer` response header and an early referrer meta declaration, so scripts and styles loaded before the client executes cannot copy a token-bearing entry URL into the `Referer` request header. Manual integrations should prefer entering the credential on the login page; use a query token for the root management WebSocket only when the client cannot set an `Authorization` header.

After **Save and apply** rotates `username`, `password`, or `access_token`, HTTP login and WebSocket upgrades immediately use the new values. All existing access and refresh tokens are revoked, and connected root-management and terminal WebSockets close with a policy-violation status. Log, account-verification, and message-debug SSE also stop their heartbeats and end their responses, so a revoked session cannot continue receiving sensitive events. The Web client reconnects with its current local credential and returns to login after the old credential is explicitly rejected. Changes limited to accounts, protocols, or logging do not interrupt management sessions. Normal shutdown and failed-start rollback use the same management-stream registry to release every timer and response. One cleanup failure does not prevent the other streams from closing, and the final error aggregates the retained failure evidence.

When a username/password session token expires naturally, established root-management and terminal WebSockets plus log, account-verification, and message-debug SSE cannot continue receiving passive data indefinitely. The server revalidates long-lived connection credentials every 30 seconds and stops heartbeats and closes the connection by the next check. Deployment-level tokens supplied by configuration or `ONEBOTS_ACCESS_TOKEN` have no session expiry, so their connections remain active until credential rotation, service shutdown, or network disconnection.

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

With host configuration `path: gateway`, every Router HTTP route is mounted under the normalized `/gateway` prefix. Probe URLs become `/gateway/health` and `/gateway/ready`, management APIs move to `/gateway/api/*`, and the root no longer exposes those HTTP routes. Both `gateway` and `/gateway/` normalize to `/gateway`; configuration validation rejects authority-like values, traversal, encoded separators, query strings, and fragments. WebSockets keep independent absolute pathnames and do not inherit the HTTP prefix, so the management WebSocket remains at `/`. `onebots status`, doctor, and service online verification read the same configuration and automatically use the normalized HTTP address. The bundled Web HTML injects the current process's non-sensitive prefix metadata on every page request and marks that entry as non-cacheable. Login, configuration, extension, probe, and protocol-outlet links consume it automatically, so deployments do not need to rebuild the Web package with `VITE_API_BASE`. An explicit build-time base still has precedence, while malformed runtime metadata falls back to the same-origin root instead of redirecting Bearer requests to another origin.

Ordinary management API responses uniformly declare `Cache-Control: no-store`, including login, token refresh, authentication failures, account and adapter inventory, system information, raw configuration, and extension state. The Web management client also sends these requests with `cache: no-store`, preventing browsers or misconfigured intermediary caches from reusing stale runtime state, configuration, or credential-bearing responses. Streaming endpoints such as log SSE retain `no-cache`, which is appropriate for long-lived streams.

In `/health`, `application` and `version` identify the running `onebots` application package, while `core_version` identifies `@onebots/core` separately. `instance_id` is generated for every process start and `started_at` records that process start time, providing evidence that a new instance has taken ownership of the port. Prometheus publishes the application through `onebots_info` and Core through `onebots_core_info`. The Web **System** page also displays both values so an upgraded dependency cannot be mistaken for the running application release.

`/ready` also carries the same `application`, `version`, `core_version`, `instance_id`, and `started_at` as `/health`. A readiness response saved on its own therefore proves which OneBots process produced it instead of trusting a same-named boolean from a proxy or another application. Its summary includes account and protocol instance totals, their online or ready counts, and `accounts_without_protocols`. Each platform also reports its number of accounts without an outlet together with protocol `ready`, `unavailable`, and `total` values. An online platform account therefore cannot hide a failed protocol `start()` or a missing protocol configuration; either case returns HTTP 503. The response's `config.status` and `config.in_sync` also prove that the file on disk is the active runtime version. An external edit, unreadable file, or host setting waiting for restart revokes readiness. A fresh gateway with no accounts remains HTTP 200 so its management surface is reachable, but returns `configured: false`, which doctor presents as a warning.

The Web header polls the same semantic `/ready` evidence every five seconds and distinguishes **production ready**, **awaiting configuration**, **not ready**, and invalid probe evidence instead of showing a green badge from online-account counts alone. Selecting the badge opens **System information** for the probe details. That page verifies the `/health` application identity, version, and instance ID together with `/ready`'s own identity, HTTP status, boolean result, account and protocol counts, and configuration state. It reports **conflicting evidence** when the two responses name different applications, versions, or instance IDs. An empty HTTP 200, another application's response, split proxy routing, or contradictory JSON therefore cannot be reported as available. The System page's ten-second automatic refresh updates both protected process information and this public probe pair. Automatic ticks and the manual **Refresh** action join an in-flight service check instead of stacking requests. A system-information or authentication-refresh request that exceeds five seconds releases the cycle for a later retry. Each page now starts only the resource polling it consumes, avoiding duplicate inventory requests from the header, System, and Bots views.

Run `onebots doctor -c config.yaml --json --strict` as an automated gate after deployment or upgrades. JSON uses a stable envelope with `schemaVersion` and records `generatedAt`, the current OneBots CLI identity and version, the effective configuration path, data directory, resolved database path, extension root, module-resolution directory, service scope and mode, and each adapter and protocol selection with its source. An archived CI report can therefore prove which installation and configuration were checked without parsing human-readable messages. An explicit configuration path gives foreground and Docker deployments an independent configuration diagnostic; when that path is the managed service's saved configuration, doctor still verifies that the service is running. Independent diagnosis follows the foreground listener by letting a non-empty `PORT` in the current process override `config.port`; `onebots send` uses the same precedence, so hosted environments such as Hugging Face do not probe or call the wrong port. An invalid `PORT` becomes an address-configuration error in the report. An installed managed service remains authoritative to its saved configuration, so a one-off shell environment used to invoke doctor is not mistaken for part of the service definition. Doctor compares the application version reported by `/health` with the current CLI. A mismatch or a legacy endpoint that cannot prove its version produces a warning, which fails strict mode and reveals an updated installation that still runs an old process or a command resolving from another installation. Default mode keeps first-run states such as no configured account, no installed or running service, or an unavailable authenticated management probe as warnings; `--strict` makes any warning set JSON `ok` to `false` and return exit code `1`. When the configured port is reachable, doctor probes both endpoints. A non-2xx response, invalid JSON, a health status other than `ok`, readiness other than `true`, missing OneBots identity, or different application versions or instances across the pair fails the check. A separate `probe-instance` result preserves the paired identity conclusion in text and JSON reports. A failed `/ready` check includes online account and ready protocol counts together with affected platforms and accounts lacking an outlet, instead of reporting an unexplained HTTP 503. Use the `onebots_accounts_without_protocols` Prometheus metric to alert on this configuration gap.

If an installed service's `service.json` is truncated, unreadable, or structurally invalid, doctor still emits a complete JSON report, marks `target.service.mode` as `invalid`, and fails the deployment gate with a `service-metadata` error. The public diagnostic includes only the metadata path rather than raw JSON fragments; rerun `onebots install` to regenerate the service definition from the current configuration. On POSIX systems, a separate `service-metadata-mode` check also proves that this runtime contract is not exposed to other users or writable by the group. User-level `--fix` restores the installer's `0600` mode, while system-level metadata is reported for an administrator to repair.

Doctor validates the current CLI and the managed service's Node.js separately. For the saved `nodePath`, it actually executes `--version`, so an existing path that is not executable, is not Node, or reports a version below 24 produces a `service-node` error. User-level services can use `--fix` to switch to doctor's current Node and regenerate the definition; system-level services must be reinstalled with administrator privileges.

The service entry no longer passes merely because `binPath` exists. Doctor resolves symbolic links to the real file, locates its owning `package.json`, and proves that the package is `onebots`, its version matches the current CLI, and the file is exactly the manifest's `bin.onebots` target. This reveals stopped services that still reference an old installation, substituted script, or damaged manifest; user-level `--fix` switches the definition to the current CLI entry.

An unreadable or unverifiable platform definition, such as a systemd unit or launchd plist, no longer aborts doctor. The `service-definition` check fails with a path-only diagnostic that does not expose file content. On POSIX, `service-definition-mode` allows the unit or plist to be publicly readable but rejects group or other-user writes. User-level `--fix` restores `0644`, while system-level definitions are reported for an administrator. The installer atomically replaces definitions and actively restores `0644`, so reinstalling also removes inherited dangerous permissions. After user-level `--fix` writes the definition, doctor reads it again and compares it with the new metadata; only a matching result is marked `fixed`. If systemctl, launchctl, or Task Scheduler fails during repair, doctor still returns the complete report, preserves the pre-repair Node.js and entry evidence, and reports only the definition path instead of echoing environment values or file content from the underlying command.

Windows user services validate both the Task Scheduler XML and the executed `onebots-user-runner.mjs`, including Node.js, the CLI entry, configuration and plugin selection, working directory, and log output. Task Scheduler runs the runner directly with Node.js without `cmd.exe` or PowerShell. The runner restores the complete argument array, so spaces, `&`, `%VAR%`, and quotes in paths or configuration values are never interpreted by a shell. A missing or modified file fails `service-definition`. Reinstalling or running user-level `doctor --fix` atomically rebuilds both files and removes the legacy `.cmd` runner before verifying the same rendering contract. Uninstall removes the task XML and both runner formats while preserving logs and user data.

Windows system services pass the complete argument array through `onebots-system-runner.mjs` in the state directory, avoiding `node-windows` splitting `scriptOptions` on spaces and corrupting configuration or entry paths. The WinSW XML and `.exe` remain in the `daemon/` directory beside the CLI entry. Doctor verifies the runner together with Node.js, the node-windows wrapper, working directory, log directory, and restart policy. Start, stop, and status target the actual `onebotsgateway.exe` service ID registered by WinSW. Any file or startup-contract drift requires an administrator to rerun `onebots install --system`, and uninstall removes the runner as well.

`service-permissions` proves that the state path used for service metadata and logs is a directory the current process can traverse, read, and write. A regular-file collision, missing directory, or insufficient access fails the deployment gate with a path-only error rather than copying the raw filesystem exception into the report.

Account management summaries also expose `name`, `version`, `path`, and `lifecycleStatus` for every protocol outlet. The Bots page distinguishes pending, starting, ready, stopping, stopped, and failed outlets instead of allowing an online account to hide a failed protocol startup. After validating an authorized management credential, doctor reads the same protected runtime state and identifies the exact `platform.account/protocol.version`. A separate `management-capabilities` check validates every adapter default manifest, account override, and the closed `accountCapabilityErrors` contract. Claiming `capabilityDeclared` without a valid manifest, publishing an override for an unknown account, returning a malformed manifest, publishing both an override and an unavailable diagnostic for the same account, or losing any account capability evidence produces an error and fails both normal and `--strict` gates without hiding the independent account and protocol lifecycle result. With no accounts, the check explicitly reports the verified adapter defaults and that no account has been configured instead of treating a vacuous zero-account count as evidence. The public `/ready` response remains aggregated by platform and does not disclose account identifiers.

The same online diagnosis verifies the management security boundary. An anonymous request to `/api/auth/me` must receive HTTP 401, and the anonymous root WebSocket must receive HTTP 401 before upgrade. Doctor then uses the configured `access_token` (including `ONEBOTS_ACCESS_TOKEN`) or username and password to confirm that authenticated HTTP and WebSocket access still work. Anonymous HTTP and WebSocket checks run concurrently. Once credentials are available, authenticated HTTP, live configuration, runtime, account-capability, and WebSocket probes also run concurrently while retaining stable report order. Each check keeps its independent two-second boundary, so a slow proxy cannot make all timeouts accumulate serially. A temporary session created by the username/password probe is logged out after every authenticated probe finishes. If a custom host keeps credentials only in memory so doctor cannot obtain them from configuration or the environment, anonymous rejection is still verified and the two authenticated probes report warnings.

Doctor also loads the selected plugins and validates the complete account and protocol configuration against their registered schemas. Every successful result includes the package name and version that actually resolved. The `plugin-selection` check records whether each category came from the CLI, configuration file, or service definition, together with the module resolution directory. Legacy configurations without `plugins` should still receive the same `-r` / `-p` arguments as the run command. If a plugin entry exists but initialization fails, doctor preserves the first underlying error line, including duplicate registration conflicts and missing runtime dependencies, instead of reducing it to a generic initialization failure.

When diagnosing an installed service, its saved definition remains the runtime contract. Passing a different explicit `-c` instead creates a standalone candidate scope: doctor uses that file's plugin defaults, does not mix in plugins from the old service, and does not mark or repair the unrelated service definition even with `--fix`. Deployment pipelines can therefore validate the next configuration before switching the service to it.

The protected `GET /api/system` response exposes `plugins`, the adapters and protocols that passed entry loading and registration contract validation in the current process, together with package names, versions, and real entry paths. The Web console shows the same inventory under **System information → Runtime plugins**. Because this evidence comes from the running process, it confirms whether an upgrade has restarted into the expected versions and distinguishes which installation supplied a same-named plugin. The initial management WebSocket `system.sync` message carries the same data.

Setup, the Web console, and runtime account operations now share one atomic configuration writer. New content is fully written and synced in the configuration directory before it replaces the live file, preventing a terminated process from leaving truncated YAML. Adding, editing, or removing one account also locks out other configuration changes and revokes readiness until the account runtime transition and file write both succeed. Before an add or edit constructs an adapter, OneBots inserts the candidate account into the current complete configuration and applies the same adapter, protocol, and inherited configuration schemas used at startup. Missing identity, platform credentials, a loaded protocol outlet, or valid field types returns HTTP 400 without touching runtime state. A platform login, protocol startup, or write failure cleans up the candidate and restores the previous account, in-memory configuration, and file; a restoration failure preserves the original and rollback evidence together. Adding an existing account is rejected, while the management API reports a concurrent configuration transaction as HTTP 409 so clients can retry after it finishes. Updates keep the immediately previous version at `<config>.bak`; new files default to mode `0600`, while existing files retain their permissions. Validate a backup with `onebots doctor` before restoring it.

Web extension installation also records the plugin version that existed before the package manager ran. After a successful package-manager command, if installed-version verification, isolated preflight, or configuration commit fails, OneBots reverses the dependency change through the same npm or pnpm runtime. A newly introduced package is removed; a previous version is installed again; and the resulting package manifest is verified. A failed recovery is never hidden: the Extensions failure record preserves both the original installation error and the recovery error so an operator can repair the dependencies and lockfile.

Extension installation selects npm or pnpm from the runtime directory and the nearest project root's lockfile, workspace declaration, and `packageManager` field. A OneBots process started directly with `node` from a pnpm workspace member still detects the parent workspace and writes the dependency to that member package instead of asking npm to parse `workspace:` or `catalog:`. A standalone npm project continues to take precedence when it has a nearer `package-lock.json`.

The release workflow packs every public package and reads the final `package.json` from each tarball. In addition to entry-point and production-file boundaries, the gate rejects any remaining `catalog:`, `workspace:`, `file:`, `link:`, `portal:`, or `patch:` dependency protocol so a failed workspace-manifest conversion cannot produce an npm package that consumers cannot install.

Before invoking the package manager, Extensions also proves that the runtime directory belongs to the current OneBots installation. Its manifest must either be the `onebots` package itself or explicitly declare that dependency, and the installed package name and version must match the current process. The runtime directory and an existing `node_modules` directory must also be writable by the current process; a read-only container mount or incorrect ownership fails before the package manager starts. OneBots selects npm or pnpm from that directory's lockfile, workspace, and `packageManager` evidence, then proves that the corresponding executable exists on the current process's `PATH`. A missing pnpm entry includes guidance to install or activate it through corepack. A global CLI started from an unrelated project, a misdirected `ONEBOTS_EXTENSION_ROOT`, a missing installation, or a different OneBots version fails before configuration is read or dependencies are changed, with guidance to select or start from the target runtime. The extension catalog API publishes the same error in advance and Web disables only cards that actually need a dependency change; an installed, version-aligned extension can still be enabled and preflighted. The server install endpoint repeats the validation before reading configuration or downloading a dependency and cannot be bypassed with stale UI state. The `extension-root` and `package-manager` checks in `onebots doctor` reuse the same proof and record it in both text and JSON reports. An explicit `ONEBOTS_EXTENSION_ROOT` takes precedence; otherwise doctor uses the managed service or current plugin-resolution directory, so an incorrect, unwritable, or package-manager-less installation target fails the deployment gate directly. If `config.yaml` is malformed or unreadable, the extension catalog falls back to a disabled selection and publishes a redacted `runtimeConfigError`, while versioned platform capabilities remain browsable. Web explains the problem and disables installation, and the server repeats the check with HTTP 422 before downloading a dependency.

Restart requests from Web **System information**, extension installation, and the management terminal now share one safety boundary. OneBots first runs plugin and configuration preflight from the service working directory. After returning the response, it calls `app.stop()` so accounts, protocols, WebSockets, and HTTP resources close in lifecycle order, then exits with the supervisor restart code. A graceful stop that exceeds 30 seconds is logged and handed to the supervisor for a forced switch instead of hanging forever. The System and Extensions pages must first obtain the current `instance_id` from a `/health` response that identifies `onebots` and send that identity back with the restart request. Before preflight or scheduling, the server rejects a stale request when another process has already taken over. A successful acknowledgement proves the application identity, the instance that handled the request, and whether it created a restart schedule. Only after validating that complete acknowledgement does Web wait for a different new instance. Legacy clients may still omit the expected identity, but receive the same structured acknowledgement with the current instance. Every `/health` and `/ready` probe has its own two-second timeout, so a proxy that holds a connection open without returning content still yields explicit evidence and allows bounded retries to continue. HTTP 200 by itself, the old process remaining online, an empty acknowledgement, or a missing identity field no longer proves restart completion.

The process keeps a one-way digest of the configuration file at startup, after every successful hot reload, and after account configuration writes. The `configState` field in the protected `GET /api/system` response and **System information → Configuration status** in the Web console expose only `in_sync`, `drifted`, or `unavailable` plus the last application time; neither the digest nor configuration content is returned. An external edit, a replaced mount, or a saved host setting that still requires a restart remains `drifted` until a successful reload or restart. The public `/ready` endpoint projects the same state and returns HTTP 503 while it is out of sync; `onebots_config_in_sync` becomes `0`, and doctor reports drift and unreadable files as distinct actionable causes. The initial management WebSocket `system.sync` message carries the same state.

On POSIX systems, doctor checks the live configuration and its `.bak` separately. Mode `0600` is private. A group-readable mode such as `0640` produces a warning and is left unchanged so service-account sharing remains possible. Access for other users or modification by the group fails the check. With explicit `--fix`, doctor tightens those high-risk modes to `0600` and records `fixed` in the JSON report for deployment auditing.

Doctor also verifies that the `data` path beside the configuration file is a directory that the current process can read, write, and traverse. The default database, security audit, and management-terminal log cache all use this directory, so managed and foreground processes no longer scatter cache files according to their working directories. When `database` is absolute or a relative path escapes the default directory, doctor also validates the resolved database file and its parent so SQLite can create journal or WAL files. An empty target, directory collision, unreadable or unwritable file, or uncreatable parent fails the gate. A colliding regular file, incorrect volume mount, or insufficient permission on the default data directory likewise fails before runtime storage initialization. A missing data directory remains a warning by default; only explicit `--fix` creates and verifies it, and an existing conflicting path is never replaced.

`onebots setup` and foreground startup use the same data-directory boundary. First-time initialization and `setup --force` validate or create that directory before writing or backing up configuration. A conflicting mount target or insufficient permission therefore preserves the current configuration, existing backup, and conflicting path instead of reporting failure after a partial configuration has already taken effect. When a configuration already exists in a non-interactive environment, setup still does not overwrite it or create a backup, but it validates YAML, the base schema, adapter and protocol configuration, every selected plugin, and validates or creates the sibling `data` directory before returning success. Foreground startup also passes this check before generating a missing default configuration and management credential.

A plugin counts as loaded only after its entry initializes and registers the factory and configuration schema promised by its CLI name. Doctor and every service preflight reject an importable package that skips registration, uses a mismatched identity, or registers a factory without its schema, instead of deferring that failure until startup or the Web console.

Package identity must form the same continuous evidence. The candidate directory's `package.json#name` must match the npm package that was actually requested before pinned-version checks and the registration contract can continue. An entry from a copied, substituted, or damaged directory is never executed. Extensions marks that dependency as unverifiable, shows the expected and actual package names, and repairs it only with the exact package name and version pinned by the current OneBots catalog. Even a successful package-manager exit is rejected and rolled back when the installed manifest claims another identity.

The Adapter and Protocol registries copy and recursively freeze Schema object, array, and regular-expression containers on first registration. Later changes to the plugin's source object, or attempts to mutate another extension contract through `getSchema()` or `getAllSchemas()`, cannot change the Schema used by the host; repeating a registration with the same source object remains idempotent. Container defaults are copied for every configuration validation, so the immutable registry contract does not leak frozen arrays or objects into a running account configuration.

Adapter and protocol presentation metadata is also stored as a frozen snapshot, so `getMetadata()` and `getAllMetadata()` no longer expose writable registry objects. Adding or removing a protocol version uses copy-on-write to create a new frozen version list. A plugin therefore cannot forge another extension's name, source information, or protocol-version evidence after its loading transaction finishes.

Each plugin entry import also runs inside its own asynchronous registration window. Top-level `await` and asynchronous work that executes before the import completes still belongs to that transaction and remains subject to ownership checks and rollback. A timer or Promise created by the entry receives a “plugin registration transaction has ended” error if it later tries to register, unregister, clear, or restore the Adapter or Protocol registries after acceptance. Those late mutations cannot leak into the verified runtime, while each subsequent plugin receives a fresh registration window.

If an entry finishes evaluating but its transaction is then rejected for a missing Schema, an out-of-scope registration, or another contract violation, OneBots re-executes that entry on the next load attempt in the same process instead of reusing Node's successful ESM cache. A repaired or reinstalled plugin can therefore be retried immediately. Once a transaction passes validation, later duplicate loads keep using that module instance and remain idempotent.

When an adapter instance is created, OneBots compares the default capability manifest in registration metadata field by field with the default result of `describeCapabilities()` and verifies that every advertised action has a concrete implementation. A mismatch or an action that still resolves to a base placeholder prevents startup, so selection evidence in Extensions cannot contradict account runtime behavior. Third-party adapters without registered capabilities remain explicitly unknown rather than receiving an invented conclusion.

`GET /api/adapters` and the management WebSocket merge the loaded-plugin inventory with account runtime state. As soon as an adapter passes the loading contract, it exposes its registered name, description, plugin version, and default capabilities even when no Bot account has been configured; an empty `accounts` array states that distinction explicitly. The Bots page can therefore compare loaded platforms and continue to account setup without misclassifying zero accounts as a missing adapter. A third-party plugin without a registered default manifest returns `capabilityDeclared: false`; Web presents an unknown-capability warning, so empty categories are not treated as proof that the platform lacks those capabilities, and doctor's `management-capabilities` check fails until the plugin supplies a trustworthy declaration.

Before the management API publishes account capabilities, it validates and snapshots each dynamic manifest, then compares its structure with the adapter default. An adapter that allocates an equivalent object for every account is therefore not mislabeled as having an account-specific manifest; only real permission or subscription differences enter `accountCapabilities`. Malformed manifests and objects mutated by a plugin after return cannot become Web capability evidence. A read or validation failure for one account is logged through its adapter and returned as a length-bounded, machine-readable `accountCapabilityErrors` entry instead of failing the entire `/api/adapters` response or other account summaries. The Web console warns that it is showing only the adapter default and that this fallback does not prove the account's actual capabilities.

`onebots install -c config.yaml -r <adapter> -p <protocol>` performs the same plugin loading and configuration validation before writing an operating-system service definition. Import-only entries, top-level `await`, schema validation, and initialization failures therefore follow foreground startup semantics; a failed preflight leaves no service that is certain to fail at startup. A successful install still does not start the service, so you can inspect its definition before running `onebots start`.

`onebots start` and `onebots restart` also read the saved service definition, resolve plugins from its installation `workingDirectory`, and validate the current configuration again. This catches plugins or configuration that were removed or damaged after installation. A failed start preflight never asks the operating system to launch the service, and a failed restart preflight leaves the existing instance running. After the operating-system command returns, the CLI polls `/health` and `/ready` for a bounded period. The online application and version must match the current CLI, readiness must succeed or remain in the configurable first-run state, and both endpoints must declare the same `instance_id`. `start` remains idempotent for an already-online service. When the service was stopped but its port was occupied, and whenever `restart` runs, that verified instance must also differ from the one observed before the operation. If the previous process still owns the port, the probes are split across instances, the target process never comes online, or identity evidence is absent, the command fails with its final probe evidence instead of reporting a premature success.

`/health`, `/ready`, and `/metrics` return `Cache-Control: no-store`, explicitly preventing browsers and intermediary caches from treating transient runtime state as reusable content. Doctor, status, start/restart/update verification, and the terminal dashboard also issue non-cacheable probe requests. As long as a proxy follows HTTP cache semantics, a deployment gate cannot use an old instance ID or stale readiness result as evidence for the current process. The terminal dashboard keeps the Web page origin separate from the Router HTTP prefix: its open action still uses the root page, while Health follows the normalized `path` to the corresponding `/health` endpoint.

The start, stop, and restart keys in the `onebots ui` terminal operations dashboard reuse these public CLI command boundaries. Dashboard starts and restarts therefore preflight the saved service definition and verify the online version, readiness, and instance switch after the operating-system action. The dashboard preserves any failure evidence instead of treating a successful process-manager command as proof that the gateway is available.

After issuing the operating-system command, `onebots stop` polls the process manager for a bounded period and reports success only when the service is no longer running; a timeout preserves the final status evidence. On macOS, stopping uses `launchctl bootout` to remove the job from its launchd domain, preventing the plist's failure restart policy from immediately relaunching the process. A later `start` or `restart` bootstraps the definition again. The terminal dashboard's stop key uses the same verification.

Foreground and managed processes share a bounded graceful-shutdown coordinator for `SIGINT` and `SIGTERM`. A signal sequence calls `app.stop()` only once and releases accounts, protocol outlets, WebSockets, and HTTP resources. A clean stop cancels the 30-second fallback and records a successful exit. If cleanup rejects, OneBots logs the error and keeps the fallback armed, so a remaining SDK or network handle cannot hang the process indefinitely. A cleanup that never settles also emits a fatal log and forces exit after the timeout, returning control to the process manager.

Core shutdown orchestration isolates extension failures. A failed protocol stop does not block the other protocol outlets or account listeners; a failed account does not block other accounts in the adapter; and an adapter or lifecycle-hook failure does not skip the remaining adapters, database, WebSocket/HTTP, security-audit, or `close` listeners. Failures while releasing lifecycle resources such as the database, Router, or HTTP server also enter the final error after the other resources finish cleaning up instead of being hidden behind a `cleanupError` log. Errors are aggregated only after every stage has had a cleanup opportunity, preserving a diagnosable failed exit while minimizing resources left for the forced fallback.

Startup uses the same complete rollback boundary. If configuration validation, management-route or log-watcher initialization, a lifecycle hook, or the HTTP listener fails, OneBots releases the accounts, protocol outlets, database, Router, WebSocket/HTTP, file watchers, and process-level log interception already created, then marks that App instance as non-restartable. If a rollback step also fails, the final error retains both the original startup error and the rollback error. A later service-manager retry creates a fresh process and App instance instead of registering routes or listeners again on a partially initialized object.

The security-audit stream is also an awaited shutdown resource. `app.stop()` and failed-start rollback wait for queued audit records to flush and for the file descriptor to close before returning. If the audit directory is unmounted, removed, or becomes inaccessible, the stream error enters the same shutdown failure aggregate instead of arriving later as an unhandled exception after temporary-directory cleanup or process exit. Repeated closure is idempotent and does not touch an already released stream.

Management-terminal logging is also an awaited shutdown resource. A normal stop first cancels every log SSE heartbeat, ends the client responses, and restores `stdout` and `stderr`. It then waits for the cache stream to close before truncating the temporary cache, preventing pending writes from reappearing after truncation. Any client or file-cleanup failure enters the shutdown error after the other resources finish. The synchronous process `exit` listener remains only as a final fallback when asynchronous work can no longer be awaited.

After startup, `onebots status` reports both the process-manager state and the semantic results of `/health` and `/ready`, followed by a separate paired-instance conclusion. It distinguishes **running and ready**, **running but awaiting configuration**, **running with an unverified version**, and **running but unavailable**. A missing or mismatched online application version, either response lacking a concrete OneBots identity, different application versions or instance IDs across the two probes, an installed but stopped service, or any failed probe returns exit code `1`; a missing installation returns `2`. A first-run gateway with no accounts remains **awaiting configuration** and exits successfully only when both identities agree, so its management surface stays usable. CI/CD can therefore use `onebots status` as a lightweight deployment gate and reserve `onebots doctor --json --strict` for full configuration and plugin diagnostics.

During configuration reloads, the HTTP liveness probe remains successful while `/ready` immediately returns HTTP 503 with `reloading: true` until the new accounts and protocol outlets finish starting or the previous configuration is restored. Initial process startup still preserves failed account or protocol state so the management surface and readiness can diagnose credentials, permissions, or platform failures. **Save and apply** instead uses a strict transaction: any asynchronous adapter, account, or protocol startup failure rejects the operation, cleans up the candidate runtime, and reconstructs the previous configuration. A switch never begins when the old runtime has not stopped completely. If candidate cleanup or restoration also fails, the final error retains both the application and rollback evidence instead of marking partial success as applied; the outer save boundary then restores the previous file. Concurrent reloads are rejected to prevent interleaved configuration changes. Prometheus exposes `onebots_reloading` for alerting on unusually long reloads. Host-setting changes still return the fields that require a process restart.

By default, `onebots update` reads the current `config.yaml` `plugins` selection, so adapters and protocols added later through the Web extension center are included in version checks and updates. Explicit `-r` and `-p` values still override their respective categories; only legacy configurations without `plugins` fall back to the service installation snapshot. The updater queries only the target OneBots application version. When a newer application is available, it stages that package in a temporary directory with install scripts disabled, reads the extension-version catalog shipped inside it, and removes the temporary content. Every selected adapter and protocol then uses the exact version from that catalog instead of independently following npm `latest` and creating a combination that OneBots never verified together. A missing or malformed catalog entry, or a staging failure, stops before the production runtime is modified. A successful package-manager exit is not accepted as proof by itself. The updater reads package manifests from the project runtime, falling back to the current OneBots installation root for a global CLI, and compares the actual version of the application and every selected plugin with those verified targets. Project-level npm updates save production dependencies with `--omit=dev`, so they do not restore development tooling in a production runtime. When npm is launched from pnpm, the updater also strips pnpm-only environment settings that npm does not support, preventing `_icqqjs-registry`, `recursive`, `store-dir`, and related warnings from obscuring diagnostics. npm and pnpm consistently use their `.cmd` entry points on Windows. Any missing or mismatched package reports the complete expected/actual evidence and stops before service preflight, definition changes, or restart. Once every installed version is proven, `onebots update` launches the updated CLI in the service `workingDirectory` and runs a connection-free preflight with that same plugin list. It rewrites the service definition and optionally restarts only after every plugin loads and the configuration validates. After a restart, the command polls `/health` and `/ready` for a bounded period. Both responses must declare the same `onebots` application, target version, and `instance_id`; that instance must also differ from the one observed before restart, while readiness must succeed or remain in the first-run state that still permits configuration. Split proxy routing keeps the verifier retrying, and a timeout preserves both identities. Deferring an interactive restart now explicitly says that the updated packages are still served by the old process. A failed installed-version check or updated-runtime preflight leaves the current process running and preserves the existing service definition. Within that safe window, the updater uses the same npm or pnpm runtime to restore every selected package to its exact previous version, removes packages that did not previously exist, and verifies every result. If recovery also fails, the error preserves both the original update problem and the recovery evidence for manual dependency and lockfile repair. Failures after the service definition or process switch has begun keep the new packages instead of blindly rolling back files used by a potentially running new instance.

Before the package manager writes a project update, the target must either be the current `onebots` package itself or explicitly depend on and contain the same installed OneBots version, and it must pass the extension center's writability checks. An SDK or plugin project that depends only on `@onebots/core` is not mistaken for a gateway runtime. Entering a project from a different global CLI version also fails before dependencies or lockfiles change and directs the operator to run that project's OneBots installation. A malformed child manifest can be contained by a verified parent project; without any trustworthy project above it, update stops instead of silently falling back to a global installation.

An update catalog is inseparable from the OneBots package root that supplies it. Whether the source is the current installation, a directory adjacent to a global CLI, or temporary staging with install scripts disabled, the updater reads the catalog only after the manifest in that same root proves both `name: onebots` and the target version. A version from one installation therefore cannot be combined with a catalog from another. A staged package that claims another name or version, or omits its manifest, fails before the production runtime changes even when the package manager exits successfully.

Automation can use `onebots update --check` without modifying the production runtime directory. It returns exit code `0` when the current combination already matches the target, `2` when updates verified by the target OneBots version catalog are available, and `1` when version lookup, catalog staging, or validation fails. A pipeline can therefore distinguish no action, schedule an update, and a failed check without parsing prose output.

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
