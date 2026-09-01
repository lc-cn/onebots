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

Doctor limits every protected management response to 4 MiB, covering username/password login, authenticated identity, system configuration state, adapter and account capabilities, and extension runtime evidence. The reader checks `Content-Length` first and continues counting actual streamed bytes, cancelling the body and failing only the affected check on overflow. Anonymous management checks and session logout do not need a body and cancel their response streams immediately. An abnormally large capability manifest from a plugin or a process that keeps sending data on the configured port therefore cannot accumulate unbounded diagnostic memory. Public `/health` and `/ready` probes retain their stricter 64 KiB limit.

`onebots doctor` does not send management credentials merely because the configured port accepts connections. It first requires public `/health` to prove the application name, current CLI version, and healthy semantics, then requires `/health` and `/ready` to agree on the application, version, and `instance_id`. A managed service must also match the `runtime_contract_id` calculated from local `service.json`. Missing or conflicting evidence adds a `management-identity` error and skips login, Bearer requests, and token-bearing WebSocket handshakes, preventing a token, username, or password from being sent accidentally to another service occupying the port. Once identity is established, Doctor also requests the Web origin without the Router prefix and records a `management-page` result that requires bounded HTML, `no-store`, `no-referrer`, and prefix metadata matching the current configuration. A generic HTTP 200 page or stale prefix cannot serve as management-page evidence. After every management check and temporary-session revocation completes, Doctor performs another credential-free `/health` request and compares the application, version, `instance_id`, and `runtime_contract_id` field by field. A process restart, port takeover, or unavailable final probe during diagnosis adds a `management-instance` error and rejects management-page, configuration, extension, capability, and runtime evidence assembled across instances. Management diagnosis still identifies a failed account or protocol when readiness returns 503 but the identity chain remains intact. Public identity is not cryptographic proof against a malicious process on the same host, so production deployments must still isolate OneBots with a dedicated service user and operating-system permissions.

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

### Dynamic object path boundary

Third-party extensions that handle externally supplied field paths can use `getValueOfObj` and `setValueToObj` from `@onebots/core`. Both helpers read and traverse own properties only, and reject empty path segments plus prototype-chain names such as `__proto__`, `constructor`, and `prototype`. An invalid path throws `SyntaxError` without changing the target object. Extensions should translate that error into an input-validation failure instead of falling back to unrestricted dynamic property traversal.

Use `deepMerge` from the same package when merging external configuration. It merges enumerable own properties only and recursively rejects the same prototype-chain names before changing the target; arrays retain their ordered deduplication behavior. A malformed account or protocol configuration therefore fails as a whole instead of leaving a partially merged result.

Use `deepClone` when retaining a configuration snapshot. A successful call is guaranteed to return an independent structured clone. Values that cannot be cloned safely, including functions and WeakMaps, throw instead of falling back to the caller-owned object. Account edits also clone the active configuration before constructing a candidate, so candidate validation, runtime switching, and persistence cannot begin with an already mutated live configuration.

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

`/health` and `/ready` processes launched through the OneBots runtime entry also publish the same `runtime_contract_id`. It is a SHA-256 digest of the normalized configuration path, effective plugin selection, Node executable, CLI entry, and working directory; the response does not directly contain raw paths or arguments. `doctor`, `status`, and the start/restart/update online gates independently calculate the expected value from local `service.json`. A missing field, disagreement between the two probes, or a digest mismatch fails verification. A same-version old process left online after reinstalling a definition, a process started from the wrong working directory, or an instance that did not adopt the new plugin selection can therefore no longer impersonate the current managed service by matching only its version and port.

The Web header polls the same semantic `/ready` evidence every five seconds and distinguishes **production ready**, **awaiting configuration**, **not ready**, and invalid probe evidence instead of showing a green badge from online-account counts alone. Selecting the badge opens **System information** for the probe details. That page verifies the `/health` application identity, version, instance ID, and runtime contract together with `/ready`'s own identity, HTTP status, boolean result, account and protocol counts, and configuration state. It reports **conflicting evidence** when the two responses name different applications, versions, instance IDs, or `runtime_contract_id` values. An empty HTTP 200, another application's response, split proxy routing, an old launch contract, or contradictory JSON therefore cannot be reported as available. The System page's ten-second automatic refresh updates both protected process information and this public probe pair. Automatic ticks and the manual **Refresh** action join an in-flight service check instead of stacking requests. A system-information or authentication-refresh request that exceeds five seconds releases the cycle for a later retry. Each page now starts only the resource polling it consumes, avoiding duplicate inventory requests from the header, System, and Bots views.

Run `onebots doctor -c config.yaml --json --strict` as an automated gate after deployment or upgrades. JSON uses a stable envelope with `schemaVersion` and records `generatedAt`, the current OneBots CLI identity and version, the effective configuration path, API/probe address in `target.baseUrl`, Web management address in `target.webUrl`, data directory, resolved database path, extension root, module-resolution directory, service scope and mode, and each adapter and protocol selection with its source. An archived CI report can therefore prove which installation, configuration, and network entry points were checked without parsing human-readable messages. Both address fields are `null` when the gateway configuration cannot be resolved, with the reason retained in the `gateway-address` check. An explicit configuration path gives foreground and Docker deployments an independent configuration diagnostic; when that path is the managed service's saved configuration, doctor still verifies that the service is running. Independent diagnosis follows the foreground listener by letting a non-empty `PORT` in the current process override `config.port`; `onebots send` uses the same precedence, so hosted environments such as Hugging Face do not probe or call the wrong port. An invalid `PORT` becomes an address-configuration error in the report. An installed managed service remains authoritative to its saved configuration, so a one-off shell environment used to invoke doctor is not mistaken for part of the service definition. Doctor compares the application version reported by `/health` with the current CLI. A mismatch or a legacy endpoint that cannot prove its version produces a warning, which fails strict mode and reveals an updated installation that still runs an old process or a command resolving from another installation. Default mode keeps first-run states such as no configured account, no installed or running service, or an unavailable authenticated management probe as warnings; `--strict` makes any warning set JSON `ok` to `false` and return exit code `1`. When the configured port is reachable, doctor probes both endpoints. A non-2xx response, invalid JSON, a health status other than `ok`, readiness other than `true`, missing OneBots identity, or different application versions or instances across the pair fails the check. A separate `probe-instance` result preserves the paired identity conclusion in text and JSON reports. A failed `/ready` check includes online account and ready protocol counts together with affected platforms and accounts lacking an outlet, instead of reporting an unexplained HTTP 503. Use the `onebots_accounts_without_protocols` Prometheus metric to alert on this configuration gap.

If an installed service's `service.json` is truncated, unreadable, or structurally invalid, doctor still emits a complete JSON report, marks `target.service.mode` as `invalid`, and fails the deployment gate with a `service-metadata` error. The public diagnostic includes only the metadata path rather than raw JSON fragments; rerun `onebots install` to regenerate the service definition from the current configuration. On POSIX systems, a separate `service-metadata-mode` check also proves that this runtime contract is not exposed to other users or writable by the group. User-level `--fix` restores the installer's `0600` mode, while system-level metadata is reported for an administrator to repair.

On first service installation, the final state directory is created with mode `0700` while parent XDG, Library, or system directories retain their platform defaults; `service.json` remains `0600`. The directory also contains launchd or Windows runners and service logs, so doctor's `service-permissions` check treats access by other users or group mutation as an error. User-level `--fix` can tighten it to `0700`. Group-only read or traversal remains a warning and is not modified automatically, preserving deployments that explicitly share logs with a service group.

Doctor validates the current CLI and the managed service's Node.js separately. For the saved `nodePath`, it actually executes `--version`, so an existing path that is not executable, is not Node, or reports a version below 24 produces a `service-node` error. User-level services can use `--fix` to switch to doctor's current Node and regenerate the definition; system-level services must be reinstalled with administrator privileges.

The service entry no longer passes merely because `binPath` exists. Doctor resolves symbolic links to the real file, locates its owning `package.json`, and proves that the package is `onebots`, its version matches the current CLI, and the file is exactly the manifest's `bin.onebots` target. This reveals stopped services that still reference an old installation, substituted script, or damaged manifest; user-level `--fix` switches the definition to the current CLI entry.

An unreadable or unverifiable platform definition, such as a systemd unit or launchd plist, no longer aborts doctor. The `service-definition` check fails with a path-only diagnostic that does not expose file content. On POSIX, `service-definition-mode` allows the unit or plist to be publicly readable but rejects group or other-user writes. User-level `--fix` restores `0644`, while system-level definitions are reported for an administrator. The installer atomically replaces definitions and actively restores `0644`, so reinstalling also removes inherited dangerous permissions. After user-level `--fix` writes the definition, doctor reads it again and compares it with the new metadata; only a matching result is marked `fixed`. If systemctl, launchctl, or Task Scheduler fails during repair, doctor still returns the complete report, preserves the pre-repair Node.js and entry evidence, and reports only the definition path instead of echoing environment values or file content from the underlying command.

Windows user services validate both the Task Scheduler XML and the executed `onebots-user-runner.mjs`, including Node.js, the CLI entry, configuration and plugin selection, working directory, and log output. Task Scheduler runs the runner directly with Node.js without `cmd.exe` or PowerShell. The runner restores the complete argument array, so spaces, `&`, `%VAR%`, and quotes in paths or configuration values are never interpreted by a shell. A missing or modified file fails `service-definition`. Reinstalling or running user-level `doctor --fix` atomically rebuilds both files and removes the legacy `.cmd` runner before verifying the same rendering contract. Uninstall removes the task XML and both runner formats while preserving logs and user data.

Windows system services pass the complete argument array through `onebots-system-runner.mjs` in the state directory, avoiding `node-windows` splitting `scriptOptions` on spaces and corrupting configuration or entry paths. The WinSW XML and `.exe` remain in the `daemon/` directory beside the CLI entry. Doctor verifies the runner together with Node.js, the node-windows wrapper, working directory, log directory, and restart policy. Start, stop, and status target the actual `onebotsgateway.exe` service ID registered by WinSW. Any file or startup-contract drift requires an administrator to rerun `onebots install --system`, and uninstall removes the runner as well.

Service installation is transactional as well. OneBots writes and registers the candidate platform definition, verifies the complete startup contract across the unit, plist, Task Scheduler XML, or WinSW files, and only then atomically commits the private `service.json` metadata. If a platform command, definition verification, or metadata commit fails, an existing installation is restored to its previous definition and verified again. A failed first installation revokes the registration and removes candidate definitions and runners instead of leaving a partially installed service that the CLI cannot manage. If restoration also fails, the error retains both the original installation failure and the rollback evidence rather than claiming the damaged previous service was restored.

`service-permissions` proves that the state path used for service metadata and logs is a directory the current process can traverse, read, and write. A regular-file collision, missing directory, or insufficient access fails the deployment gate with a path-only error rather than copying the raw filesystem exception into the report.

Account management summaries also expose `name`, `version`, `path`, and `lifecycleStatus` for every protocol outlet. The Bots page distinguishes pending, starting, ready, stopping, stopped, and failed outlets instead of allowing an online account to hide a failed protocol startup. `GET /api/adapters` uses `accountLifecycleControl` to state whether an adapter actually implements manual online and offline control. The Web UI enables a direction only when it is implemented and otherwise labels manual switching as unsupported. `POST /api/bots/start` and `/api/bots/stop` validate the target identity: missing fields return HTTP 400, a missing adapter or account returns 404, and an unimplemented operation returns 501. They no longer report an empty HTTP 200 as success. The legacy management WebSocket `bot.start` and `bot.stop` actions use the same execution and error classification. Success retains the compatible `bot.change` event; failure returns a `bot.change.result` receipt correlated by `echo` with a stable error code. Malformed JSON and plugin failures no longer escape as message-handler rejections without a receipt. HTTP and WebSocket also share one per-account exclusion state. Manual switches, account configuration transactions, and full reloads acquire the same runtime lease through `@onebots/core`'s `acquireRuntimeOperation()`. `/ready` withdraws readiness with `reloading: true` for the lease duration, and other conflicting operations cannot begin. The lease publishes the boolean lock and operation reason as one atomic boundary. Its idempotent `release()` uses a private ownership token so an expired release cannot clear a later operation, and callers enter `try/finally` immediately after acquisition so a synchronous preflight failure such as reading the old configuration still restores readiness. `runtime_operation` further distinguishes `configuration_reload`, `account_configuration`, `account_lifecycle`, `idle`, and `unknown` when an embedded host cannot prove the reason. Doctor and Web can therefore identify a full reload, an account configuration transaction, or a manual account switch instead of reporting every temporary outage as a configuration reload. `onebots_runtime_operation{operation="..."}` continuously publishes mutually exclusive 0/1 series for every state, while the existing `reloading` field and `onebots_reloading` metric remain compatible. Different accounts may still run in parallel, and readiness returns only after the final operation finishes. Failure paths release the lease as well. Web displays the server's bounded single-line diagnosis and falls back to the HTTP status for a non-JSON response instead of collapsing every cause into a generic failure. After validating an authorized management credential, doctor reads the same protected runtime state and identifies the exact `platform.account/protocol.version`. A separate `management-capabilities` check validates every adapter default manifest, account override, and the closed `accountCapabilityErrors` contract. Claiming `capabilityDeclared` without a valid manifest, publishing an override for an unknown account, returning a malformed manifest, publishing both an override and an unavailable diagnostic for the same account, or losing any account capability evidence produces an error and fails both normal and `--strict` gates without hiding the independent account and protocol lifecycle result. With no accounts, the check explicitly reports the verified adapter defaults and that no account has been configured instead of treating a vacuous zero-account count as evidence. The public `/ready` response remains aggregated by platform and does not disclose account identifiers.

The same online diagnosis verifies the management security boundary. An anonymous request to `/api/auth/me` must receive HTTP 401, and the anonymous root WebSocket must receive HTTP 401 before upgrade. Doctor then uses the configured `access_token` (including `ONEBOTS_ACCESS_TOKEN`) or username and password to confirm that authenticated HTTP and WebSocket access still work. Anonymous HTTP and WebSocket checks run concurrently. Once credentials are available, authenticated HTTP, live configuration, runtime, account-capability, and WebSocket probes also run concurrently while retaining stable report order. Each check keeps its independent two-second boundary, so a slow proxy cannot make all timeouts accumulate serially. A temporary session created by the username/password probe is logged out after every authenticated probe finishes. If a custom host keeps credentials only in memory so doctor cannot obtain them from configuration or the environment, anonymous rejection is still verified and the two authenticated probes report warnings.

Doctor also loads the selected plugins and validates the complete account and protocol configuration against their registered schemas. Every successful result includes the package name and version that actually resolved. The `plugin-selection` check records whether each category came from the CLI, configuration file, or service definition, together with the module resolution directory. Legacy configurations without `plugins` should still receive the same `-r` / `-p` arguments as the run command. If a plugin entry exists but initialization fails, doctor preserves the first underlying error line, including duplicate registration conflicts and missing runtime dependencies, instead of reducing it to a generic initialization failure.

When diagnosing an installed service, its saved definition remains the runtime contract. Passing a different explicit `-c` instead creates a standalone candidate scope: doctor uses that file's plugin defaults, does not mix in plugins from the old service, and does not mark or repair the unrelated service definition even with `--fix`. Deployment pipelines can therefore validate the next configuration before switching the service to it.

The protected `GET /api/system` response exposes `plugins`, the adapters and protocols that passed entry loading and registration contract validation in the current process, together with package names, versions, and real entry paths. The Web console shows the same inventory under **System information → Runtime plugins**. Because this evidence comes from the running process, it confirms whether an upgrade has restarted into the expected versions and distinguishes which installation supplied a same-named plugin. The initial management WebSocket `system.sync` message carries the same data.

Setup, the Web console, and runtime account operations now share one atomic configuration writer. New content is fully written and synced in the configuration directory before it replaces the live file, preventing a terminated process from leaving truncated YAML. Adding, editing, or removing one account also locks out other configuration changes and revokes readiness until the account runtime transition and file write both succeed. Before an add or edit constructs an adapter, OneBots inserts the candidate account into the current complete configuration and applies the same adapter, protocol, and inherited configuration schemas used at startup. Missing identity, platform credentials, a loaded protocol outlet, or valid field types returns HTTP 400 without touching runtime state. A platform login, protocol startup, or write failure cleans up the candidate and restores the previous account, in-memory configuration, and file; a restoration failure preserves the original and rollback evidence together. Adding an existing account is rejected, while the management API reports a concurrent configuration transaction as HTTP 409 so clients can retry after it finishes. Updates keep the immediately previous version at `<config>.bak`; new files default to mode `0600`, while existing files retain their permissions. When setup or the startup entry must generate and persist a new management token, it tightens both the live file and the new backup to `0600` instead of allowing the credential to inherit group-readable or public permissions. A deployment that supplies an environment Secret without persisting credentials retains its intentional shared mode. Validate a backup with `onebots doctor` before restoring it.

On POSIX deployments, doctor's `config-dir-mode` check also proves that the real directory containing the configuration is not writable by the group or other users. Even a `0600` file can be replaced by renaming another entry over the same path when its parent directory is writable, so a directory without sticky-bit protection fails the deployment gate. Common project directories such as `0755`, which allow traversal and directory reads without mutation, pass. Shared temporary directories such as `1777` retain a warning and still fail strict mode. Doctor does not automatically change a parent directory that other applications may share; its owner must adjust permissions explicitly or move the configuration into an isolated directory.

Web extension installation also records the plugin version that existed before the package manager ran. Even when npm or pnpm exits nonzero after changing the package because of a lifecycle script, network failure, or timeout, OneBots compares installed versions, dependency declarations, public lockfiles, and package-manager internal lockfiles, then reverses the dependency change when any evidence changed. A successful package-manager command followed by failed installed-version verification, isolated preflight, or configuration commit enters the same recovery boundary. A newly introduced package is removed; a previous version is installed again; and the resulting package manifest, dependency declaration, and lockfile digests are verified. Remaining metadata drift is a recovery failure and is never hidden: the Extensions failure record preserves both the original installation error and the recovery error so an operator can repair the dependencies and lockfile.

Web extension installation and `onebots update` acquire the same cross-process `.onebots-package-mutation.lock` lease in a shared runtime directory. Multiple managed instances, reverse-proxy retries, parallel management requests, and CLI updates therefore cannot interleave changes to `package.json`, lockfiles, and `node_modules`, or roll back another operation's successful result from an older snapshot. A later operation reports the active transaction, host, process ID, operation ID, and start time; a Web request maps that conflict to HTTP 409. The protected `GET /api/extensions/package-mutation` endpoint proactively returns an `idle`, `active`, `recoverable`, or `invalid` state with redacted ownership evidence and never returns the lease token. The Extensions page keeps observing an active cross-process install or update, identifies its owner, and disables installation until it finishes. A recoverable abandoned lease instead explains that the next package mutation will reclaim it safely.

Update install and reverse-recovery commands each have a ten-minute limit, and the updated-runtime preflight has a 60-second limit, so a package transaction cannot occupy the lease indefinitely. A random ownership token prevents an expired holder from deleting a later operation's lease. On the same host, OneBots reclaims a lease only after proving that its PID exited; waiting for restart confirmation beyond 30 minutes cannot steal an active update. A different host or PID namespace cannot use its local process probe as false exit evidence and may reclaim a remote lease only after 30 minutes. A damaged lease inside that protection window is never guessed away; the diagnostic asks the operator to wait or inspect the runtime directory.

The extension catalog publishes three separate pieces of evidence: the version verified for the current OneBots release, the version installed on disk, and the version actually loaded by the current process. When installation or upgrade has completed but the process has not restarted, Web no longer treats a true loaded flag as proof that the new disk version is active. The card shows both Installed and Current process versions, marks the state as Waiting for version switch, and offers a managed restart. A foreground process instead receives an explicit manual-restart instruction. Adapter capabilities remain tied to the plugin version actually loaded by the process, while protocol extensions expose the same version difference even without a capability catalog. A missing version is shown as unknown and never inferred to match.

After obtaining management credentials, `onebots doctor` reads the protected `/api/extensions` and `/api/extensions/package-mutation` endpoints in parallel. It independently validates the evidence contract, runtime-version convergence, and that the shared runtime directory has no unfinished package mutation. The check fails with concrete extension or transaction evidence when an enabled extension lacks its disk dependency or is not loaded, a loaded version is missing or differs from disk, the disk version of an enabled or loaded extension differs from the version verified for the current OneBots release, a cross-process lease is active or unverifiable, an abandoned lease is recoverable but not yet cleaned up, an installation transaction is incomplete, or the catalog, configuration, or package manifest reports an error. A shared catalog error is reported only once. Without management credentials the check is a warning, so `--strict` still rejects a deployment whose extension versions and quiescent package state cannot be proved. Public readiness continues to describe whether the current process can serve traffic and does not remove traffic merely because a completed extension upgrade is waiting for restart.

Extension installation selects npm or pnpm from the runtime directory and the nearest project root's lockfile, workspace declaration, dependency protocols, and `packageManager` field. A OneBots process started directly with `node` from a pnpm workspace member still detects the parent workspace. A `catalog:` dependency is also direct pnpm evidence, so OneBots does not ask npm to parse it and fail later with `EUNSUPPORTEDPROTOCOL`. When `ONEBOTS_EXTENSION_ROOT` or the deployment directory is a symbolic link, package-manager evidence follows the link target's canonical path while the install command still runs in the configured runtime directory. A link to a workspace member therefore cannot fall back to npm merely because the link's parent has no lockfile. A standalone npm project continues to take precedence when it has a nearer `package-lock.json` or the `npm-shrinkwrap.json` commonly used for production deployments. OneBots keeps using npm for such a shrinkwrapped runtime even when its process was launched from a pnpm environment, so it cannot create a second lockfile format. An npm lockfile together with a `catalog:` dependency is treated as a conflict before any package manager starts, with guidance to remove the stale lockfile or correct the dependency declaration. Other conflicting npm and pnpm evidence, Yarn, Bun, or an invalid `packageManager` declaration also stop at the same boundary. The extension catalog, installation endpoint, doctor, and updater report the directory-level error before querying or changing dependencies and require the operator to keep only the evidence for the actual package manager.

The release workflow packs every public package and reads the final `package.json` from each tarball. In addition to entry-point and production-file boundaries, the gate rejects any remaining `catalog:`, `workspace:`, `file:`, `link:`, `portal:`, or `patch:` dependency protocol so a failed workspace-manifest conversion cannot produce an npm package that consumers cannot install.

Before invoking the package manager, Extensions also proves that the runtime directory belongs to the current OneBots installation. Its manifest must either be the `onebots` package itself or explicitly declare that dependency, and the installed package name and version must match the current process. Runtime roots, installed OneBots packages, service entries, update targets, and package-manager detection all use the same 1 MiB regular-manifest boundary, so an oversized, escaping, or special `package.json` fails before permission checks, command execution, dependency writes, or acceptance of an update artifact. The runtime directory and an existing `node_modules` directory must also be writable by the current process; a read-only container mount or incorrect ownership fails before the package manager starts. OneBots selects npm or pnpm from that directory's lockfile, workspace, and `packageManager` evidence, then proves that the corresponding executable exists on the current process's `PATH`. A missing pnpm entry includes guidance to install or activate it through corepack. A global CLI started from an unrelated project, a misdirected `ONEBOTS_EXTENSION_ROOT`, a missing installation, or a different OneBots version fails before configuration is read or dependencies are changed, with guidance to select or start from the target runtime. The extension catalog API publishes the same error in advance and Web disables only cards that actually need a dependency change; an installed, version-aligned extension can still be enabled and preflighted. The server install endpoint repeats the validation before reading configuration or downloading a dependency and cannot be bypassed with stale UI state. The `extension-root` and `package-manager` checks in `onebots doctor` reuse the same proof and record it in both text and JSON reports. An explicit `ONEBOTS_EXTENSION_ROOT` takes precedence; otherwise doctor uses the managed service or current plugin-resolution directory, so an incorrect, unwritable, or package-manager-less installation target fails the deployment gate directly. If `config.yaml` is malformed or unreadable, the extension catalog falls back to a disabled selection and publishes a redacted `runtimeConfigError`, while versioned platform capabilities remain browsable. Web explains the problem and disables installation, and the server repeats the check with HTTP 422 before downloading a dependency.

Restart requests from Web **System information**, extension installation, and the management terminal now share one safety boundary. OneBots first runs plugin and configuration preflight from the service working directory. After returning the response, it calls `app.stop()` so accounts, protocols, WebSockets, and HTTP resources close in lifecycle order, then exits with the supervisor restart code. A graceful stop that exceeds 30 seconds is logged and handed to the supervisor for a forced switch instead of hanging forever. The System and Extensions pages must first obtain the current `instance_id` from a `/health` response that identifies `onebots` and send that identity back with the restart request. Before preflight or scheduling, the server rejects a stale request when another process has already taken over. A successful acknowledgement proves the application identity, the instance that handled the request, and whether it created a restart schedule. Only after validating that complete acknowledgement does Web wait for a different new instance. Legacy clients may still omit the expected identity, but receive the same structured acknowledgement with the current instance. Every `/health` and `/ready` probe has its own two-second timeout, so a proxy that holds a connection open without returning content still yields explicit evidence and allows bounded retries to continue. HTTP 200 by itself, the old process remaining online, an empty acknowledgement, or a missing identity field no longer proves restart completion.

The process keeps a one-way digest of the configuration file at startup, after every successful hot reload, and after account configuration writes. The `configState` field in the protected `GET /api/system` response and **System information → Configuration status** in the Web console expose only `in_sync`, `drifted`, or `unavailable` plus the last application time; neither the digest nor configuration content is returned. An external edit, a replaced mount, or a saved host setting that still requires a restart remains `drifted` until a successful reload or restart. The public `/ready` endpoint projects the same state and returns HTTP 503 while it is out of sync; `onebots_config_in_sync` becomes `0`, and doctor reports drift and unreadable files as distinct actionable causes. The initial management WebSocket `system.sync` message carries the same state.

On POSIX systems, doctor checks the live configuration and its `.bak` separately. Mode `0600` is private. A group-readable mode such as `0640` produces a warning and is left unchanged so service-account sharing remains possible. Access for other users or modification by the group fails the check. With explicit `--fix`, doctor tightens those high-risk modes to `0600` and records `fixed` in the JSON report for deployment auditing.

Doctor also verifies that the `data` path beside the configuration file is a directory that the current process can read, write, and traverse. The default database, security audit, and management-terminal log cache all use this directory, so managed and foreground processes no longer scatter cache files according to their working directories. When `database` is absolute or a relative path escapes the default directory, doctor also validates the resolved database file and its parent so SQLite can create journal or WAL files. On POSIX, separate `database-mode` and `database-dir-mode` checks prove that the file is not exposed to other users and that its real parent cannot replace the database path. A shared temporary directory protected by a sticky bit remains a warning visible to strict mode. Doctor does not modify user-selected database storage automatically; its file or directory owner must correct it. An empty target, directory collision, unreadable or unwritable file, or uncreatable parent fails the gate. A colliding regular file, incorrect volume mount, or insufficient permission on the default data directory likewise fails before runtime storage initialization. A missing data directory remains a warning by default; only explicit `--fix` creates and verifies it, and an existing conflicting path is never replaced.

New data directories use mode `0700` on POSIX systems. The SQLite runtime also creates missing custom parent directories as `0700` and tightens both new and existing database files to `0600` before opening them, preventing Node's default umask from producing publicly readable `0644` files. Doctor's `data-dir-mode` check treats access by other users or mutation by the group as an error, and `--fix` can explicitly tighten it to `0700`. Group-only read or traversal remains a warning and is not changed automatically, preserving deployments that intentionally share a service group. Individual database or log file modes cannot prevent path replacement inside a writable directory, so this evidence is independent from the configuration and backup file mode checks.

When `public_static_dir` is enabled, the real target of a relative path must remain inside the configuration directory; a symbolic link cannot redirect it elsewhere. Management uploads first write a unique temporary file inside the static root and then atomically replace the final file. Existing symbolic links, directories, and other special files are neither followed nor overwritten, and the delete endpoint manages regular files only. To serve a directory outside the configuration directory, configure an absolute path explicitly and control its ownership and write permissions separately.

Doctor's `public-static-dir` check reuses the runtime's real-path rules and publishes the final directory as JSON `target.publicStaticDirectory`. A missing directory is a warning and `--fix` can create it safely; an escaping path, invalid path type, or unreadable directory fails the check. A readable directory that the current process cannot write remains a warning, explicitly proving that static serving works while management uploads do not.

`onebots setup` and foreground startup use the same data-directory boundary. First-time initialization and `setup --force` validate or create that directory before writing or backing up configuration. A conflicting mount target or insufficient permission therefore preserves the current configuration, existing backup, and conflicting path instead of reporting failure after a partial configuration has already taken effect. When a configuration already exists in a non-interactive environment, setup still does not overwrite it or create a backup, but it validates YAML, the base schema, adapter and protocol configuration, every selected plugin, and validates or creates the sibling `data` directory before returning success. Foreground startup also passes this check before generating a missing default configuration and management credential.

A plugin counts as loaded only after its entry initializes and registers the factory and configuration schema promised by its CLI name. Doctor and every service preflight reject an importable package that skips registration, uses a mismatched identity, or registers a factory without its schema, instead of deferring that failure until startup or the Web console.

Package identity must form the same continuous evidence. The candidate directory's `package.json#name` must match the npm package that was actually requested before pinned-version checks and the registration contract can continue. Before reading it, OneBots proves that the manifest remains inside the real package root, is a regular file, and is no larger than 1 MiB. The final entry must also be a regular file inside that root, so a directory, device, or other special file cannot masquerade as a manifest or executable entry. A workspace or pnpm symlink may still provide the whole package directory, but an `exports`, `module`, or `main` entry inside that package cannot use a second symlink to escape the real package root. A non-regular or escaping entry is rejected before any plugin code executes. An entry from a copied, substituted, or damaged directory is likewise never executed. Even when its manifest reports the pinned version, Extensions marks that dependency as unverifiable and presents the specific reason. The Repair action tells npm or pnpm to force the exact package version pinned by the current OneBots catalog back onto disk. If the resulting package is still unverifiable despite a successful package-manager exit, installation fails and restores the previous dependency declaration and version.

The Adapter and Protocol registries copy and recursively freeze Schema object, array, and regular-expression containers on first registration. Later changes to the plugin's source object, or attempts to mutate another extension contract through `getSchema()` or `getAllSchemas()`, cannot change the Schema used by the host; repeating a registration with the same source object remains idempotent. Container defaults are copied for every configuration validation, so the immutable registry contract does not leak frozen arrays or objects into a running account configuration.

Adapter and protocol presentation metadata is also stored as a frozen snapshot, so `getMetadata()` and `getAllMetadata()` no longer expose writable registry objects. Adding or removing a protocol version uses copy-on-write to create a new frozen version list. A plugin therefore cannot forge another extension's name, source information, or protocol-version evidence after its loading transaction finishes.

Successful registration does not make the host blindly trust a factory result. An adapter instance must retain the registered platform identity and current App reference and provide account creation, capability description, and lifecycle methods. A protocol instance must match the registered name and version, current adapter and account, protocol identity in its configuration, and the complete runtime interface. Any mismatch raises a validation error carrying the extension identity before the instance enters an account or starts listening, instead of surfacing later as a misplaced route, readiness fault, or event-dispatch failure.

Each plugin entry import also runs inside its own asynchronous registration window. Top-level `await` and asynchronous work that executes before the import completes still belongs to that transaction and remains subject to ownership checks and rollback. A timer or Promise created by the entry receives a “plugin registration transaction has ended” error if it later tries to register, unregister, clear, or restore the Adapter or Protocol registries after acceptance. Those late mutations cannot leak into the verified runtime, while each subsequent plugin receives a fresh registration window.

If an entry finishes evaluating but its transaction is then rejected for a missing Schema, an out-of-scope registration, or another contract violation, OneBots re-executes that entry on the next load attempt in the same process instead of reusing Node's successful ESM cache. A repaired or reinstalled plugin can therefore be retried immediately. Once a transaction passes validation, later duplicate loads keep using that module instance and remain idempotent.

After a plugin passes validation, the current process pins its logical name to the resolved package name, manifest version, and canonical entry path. Repeated loads of that exact identity remain idempotent. If the same logical name later resolves to another package, entry, or on-disk version, OneBots rejects it before executing the entry, so a conflicting package cannot produce side effects outside the registries first. The loaded-plugin inventory continues to report the version whose code actually evaluated instead of relabeling old ESM-cached code as a newly installed version; restart OneBots after a dependency upgrade to establish the new plugin identity.

The `onebots mcp` stdio path also reuses the canonical `@onebots/protocol-mcp-v1` entry already accepted by the current process instead of resolving another protocol copy from inside the `onebots` package. This prevents a strict pnpm layout from loading the sibling plugin for the gateway and then incorrectly reporting it missing for stdio. Stdio requests run in input order. An asynchronous handler failure returns JSON-RPC `-32603` only for a request with an `id`; notifications receive no response, and error details use the normal log instead of stdout. If account selection, MCP configuration, entry import, or export validation fails after the App starts, the command stops every account, protocol, and listener it created; if cleanup also fails, both errors remain visible. Closing stdin waits for accepted requests to finish, and repeated closure reuses the same stop operation.

When an adapter instance is created, OneBots compares the default capability manifest in registration metadata field by field with the default result of `describeCapabilities()` and verifies that every advertised action has a concrete implementation. A mismatch or an action that still resolves to a base placeholder prevents startup, so selection evidence in Extensions cannot contradict account runtime behavior. Third-party adapters without registered capabilities remain explicitly unknown rather than receiving an invented conclusion.

`GET /api/adapters` and the management WebSocket merge the loaded-plugin inventory with account runtime state. As soon as an adapter passes the loading contract, it exposes its registered name, description, plugin version, and default capabilities even when no Bot account has been configured; an empty `accounts` array states that distinction explicitly. The Bots page can therefore compare loaded platforms and continue to account setup without misclassifying zero accounts as a missing adapter. A third-party plugin without a registered default manifest returns `capabilityDeclared: false`; Web presents an unknown-capability warning, so empty categories are not treated as proof that the platform lacks those capabilities, and doctor's `management-capabilities` check fails until the plugin supplies a trustworthy declaration.

Before the management API publishes account capabilities, it validates and snapshots each dynamic manifest, then compares its structure with the adapter default. An adapter that allocates an equivalent object for every account is therefore not mislabeled as having an account-specific manifest; only real permission or subscription differences enter `accountCapabilities`. Malformed manifests and objects mutated by a plugin after return cannot become Web capability evidence. A read or validation failure for one account is logged through its adapter and returned as a length-bounded, machine-readable `accountCapabilityErrors` entry instead of failing the entire `/api/adapters` response or other account summaries. The Web console warns that it is showing only the adapter default and that this fallback does not prove the account's actual capabilities.

`onebots install -c config.yaml -r <adapter> -p <protocol>` performs the same plugin loading and configuration validation before writing an operating-system service definition. Service preflight also requires the configuration file itself to contain an `access_token` or complete username and password. A temporary `ONEBOTS_ACCESS_TOKEN` in the current shell is not copied into systemd, launchd, or Windows service definitions, so it cannot prove that the managed process has credentials. Persist credentials in the configuration, or unset that environment variable before running `onebots setup -c config.yaml --force` to generate and store a secure token. Doctor publishes the same conclusion as `service-credentials` without exposing the credential. Import-only entries, top-level `await`, schema validation, and initialization failures therefore follow foreground startup semantics; a failed preflight leaves no service that is certain to fail at startup. A first install does not start the service, and an authoritative stopped state after an update leads to a `onebots start` instruction. When the definition actually changes and the process manager reports a running instance both before and after installation, the command does not silently restart it and instead directs the operator to `onebots restart`; an idempotent install of the same definition lets the instance continue. If process-manager state is unavailable or changes unexpectedly, the command directs the operator to `onebots status` rather than inferring the current state from an old snapshot.

`onebots start` and `onebots restart` also read the saved service definition, resolve plugins from its installation `workingDirectory`, and validate the current configuration again. This catches plugins or configuration that were removed or damaged after installation. A failed start preflight never asks the operating system to launch the service, and a failed restart preflight leaves the existing instance running. After the operating-system command returns, the CLI polls `/health` and `/ready` for a bounded period. The online application and version must match the current CLI, readiness must succeed or remain in the configurable first-run state, and both endpoints must declare the same `instance_id`. `start` remains idempotent for an already-online service. When the service was stopped but its port was occupied, and whenever `restart` runs, that verified instance must also differ from the one observed before the operation. If the previous process still owns the port, the probes are split across instances, the target process never comes online, or identity evidence is absent, the command fails with its final probe evidence instead of reporting a premature success.

CLI start and restart now also verify that the platform definition matches service metadata before invoking the process manager. Managed restarts requested from the running System page, Extensions, or terminal use the same boundary: the current process must match installed metadata by configuration path, Node executable, CLI entry, and working directory, and every matching scope must have a valid platform definition before the process exits for its supervisor. Definition drift leaves the current instance online and directs the operator to rerun `onebots install`, instead of exposing an incorrect launch command only after a healthy process has stopped.

`onebots uninstall` likewise does not treat an accepted stop request as proof that the service has stopped. It waits for an authoritative stopped state within a bounded window before deleting the systemd, launchd, or Windows definition and private `service.json`. If the service remains active, its supervisor relaunches it, or status queries are unavailable, uninstall fails while preserving both definition and metadata, so operators can still run `status`, inspect logs, or retry the stop. Platform removal and metadata commit also form one transaction; systemd and Windows task deletion errors are no longer ignored. Failure at either step rewrites and verifies the original definition while retaining private metadata. If recovery also fails, the error preserves both removal and recovery evidence and directs the operator to rerun `onebots install`. A recovered service remains stopped. Configuration, logs, and the database also remain intact after a successful uninstall.

`/health`, `/ready`, and `/metrics` return `Cache-Control: no-store`, explicitly preventing browsers and intermediary caches from treating transient runtime state as reusable content. Doctor, status, start/restart/update verification, and the terminal dashboard also issue non-cacheable probe requests. As long as a proxy follows HTTP cache semantics, a deployment gate cannot use an old instance ID or stale readiness result as evidence for the current process. The terminal dashboard keeps the Web page origin separate from the Router HTTP prefix: its open action still uses the root page, while Health follows the normalized `path` to the corresponding `/health` endpoint.

The start, stop, and restart keys in the `onebots ui` terminal operations dashboard reuse these public CLI command boundaries. Dashboard starts and restarts therefore preflight the saved service definition and verify the online version, readiness, and instance switch after the operating-system action. The dashboard preserves any failure evidence instead of treating a successful process-manager command as proof that the gateway is available.

After issuing the operating-system command, `onebots stop` polls the process manager for a bounded period and reports success only when the service is no longer running; a timeout preserves the final status evidence. A process-manager query failure is no longer folded into `running: false`: stop verification keeps retrying and explicitly says it cannot confirm the stop if no authoritative result arrives. `onebots start` also stops when the current state is unknown instead of issuing a duplicate start to a possibly running service. Linux collects evidence with `systemctl show ActiveState`, which succeeds for a normally inactive unit. macOS accepts only launchd's explicit job-not-loaded response as stopped and keeps other control-plane errors as failures. On macOS, stopping uses `launchctl bootout` to remove the job from its launchd domain, preventing the plist's failure restart policy from immediately relaunching the process. A later `start` or `restart` bootstraps the definition again. The terminal dashboard's stop key uses the same verification.

Foreground and managed processes share a bounded graceful-shutdown coordinator for `SIGINT` and `SIGTERM`. A signal sequence calls `app.stop()` only once and releases accounts, protocol outlets, WebSockets, and HTTP resources. A clean stop cancels the 30-second fallback and records a successful exit. If cleanup rejects, OneBots logs the error and keeps the fallback armed, so a remaining SDK or network handle cannot hang the process indefinitely. A cleanup that never settles also emits a fatal log and forces exit after the timeout, returning control to the process manager.

Core shutdown orchestration isolates extension failures. A failed protocol stop does not block the other protocol outlets or account listeners; a failed account does not block other accounts in the adapter; and an adapter or lifecycle-hook failure does not skip the remaining adapters, database, WebSocket/HTTP, security-audit, or `close` listeners. Failures while releasing lifecycle resources such as the database, Router, or HTTP server also enter the final error after the other resources finish cleaning up instead of being hidden behind a `cleanupError` log. Errors are aggregated only after every stage has had a cleanup opportunity, preserving a diagnosable failed exit while minimizing resources left for the forced fallback.

Startup uses the same complete rollback boundary. If configuration validation, management-route or log-watcher initialization, a lifecycle hook, or the HTTP listener fails, OneBots releases the accounts, protocol outlets, database, Router, WebSocket/HTTP, file watchers, and process-level log interception already created, then marks that App instance as non-restartable. If a rollback step also fails, the final error retains both the original startup error and the rollback error. A later service-manager retry creates a fresh process and App instance instead of registering routes or listeners again on a partially initialized object.

The security-audit stream is also an awaited shutdown resource. `app.stop()` and failed-start rollback wait for queued audit records to flush and for the file descriptor to close before returning. If the audit directory is unmounted, removed, or becomes inaccessible, the stream error enters the same shutdown failure aggregate instead of arriving later as an unhandled exception after temporary-directory cleanup or process exit. Repeated closure is idempotent and does not touch an already released stream.

Management-terminal logging is also an awaited shutdown resource. A normal stop first cancels every log SSE heartbeat, ends the client responses, and restores `stdout` and `stderr`. It then waits for the cache stream to close before truncating the temporary cache, preventing pending writes from reappearing after truncation. Any client or file-cleanup failure enters the shutdown error after the other resources finish. The synchronous process `exit` listener remains only as a final fallback when asynchronous work can no longer be awaited.

Before reading configuration or requesting an HTTP endpoint, `onebots status` now validates the actual systemd unit, launchd plist, or Windows task/service launch contract against its `service.json` metadata using the platform-specific definition rules. An unreadable or drifted definition returns **running with unverifiable status**, preserves the definition path, and skips HTTP evidence so a managed process cannot be combined with an unrelated OneBots instance at the metadata address and reported as ready. The JSON report records the path, `current` result, and redacted error in `serviceDefinition`.

After startup, `onebots status` reports the process-manager state, the semantic results of `/health` and `/ready`, and an online Web management-page check, followed by a separate paired-instance conclusion. The page check requests `target.webUrl` and requires bounded HTML, Router-prefix metadata matching the current configuration, and `no-store` plus `no-referrer` response headers. A generic HTTP 200 response, a stale prefix, or a missing static entry makes the status unavailable. It distinguishes **running and ready**, **running but awaiting configuration**, **running with an unverified version**, and **running but unavailable**. A missing or mismatched online application version, either response lacking a concrete OneBots identity, different application versions or instance IDs across the two probes, an installed but stopped service, or any failed probe returns exit code `1`; a missing installation returns `2`. A first-run gateway with no accounts remains **awaiting configuration** and exits successfully only when both identities agree, so its management surface stays usable. CI/CD can run `onebots status --json` for a stable `schemaVersion: 1` report containing its generation time, current CLI identity, service scope, configuration path, API probe URL in `target.baseUrl`, Web URL in `target.webUrl`, process-manager evidence, and the graded `health`, `ready`, `probe-instance`, and `management-page` results with their instance identity. Top-level `status` is one of `uninstalled`, `stopped`, `ready`, `pending_configuration`, `version_unverified`, or `unavailable`; `ok` is true only when the gateway is ready or still permits first-time configuration. An unreadable configuration records its reason in `probe.error` without inventing HTTP evidence. If service metadata is corrupt, `processManager.installed` and `running` are `null`, the error exposes only the metadata path, and neither the process-manager command nor the probes run. When the process-manager command itself fails, installed evidence remains available but `running` is `null`, `processManager.error` records the query failure, top-level status is `unavailable`, and doctor likewise treats it as an error rather than a stopped-service warning. A lightweight gate can therefore use the exit code while also archiving and parsing the evidence, reserving `onebots doctor --json --strict` for full configuration and plugin diagnostics.

During configuration reloads, the HTTP liveness probe remains successful while `/ready` immediately returns HTTP 503 with `reloading: true` until the new accounts and protocol outlets finish starting or the previous configuration is restored. Initial process startup still preserves failed account or protocol state so the management surface and readiness can diagnose credentials, permissions, or platform failures. Accounts under one adapter are attempted independently: one failed account does not prevent later accounts from coming online, every failure log carries its platform and account identity, and multiple failures are returned together without losing evidence from later accounts. **Save and apply** instead uses a strict transaction: any asynchronous adapter, account, or protocol startup failure rejects the operation, cleans up the candidate runtime, and reconstructs the previous configuration. A switch never begins when the old runtime has not stopped completely. If candidate cleanup or restoration also fails, the final error retains both the application and rollback evidence instead of marking partial success as applied; the outer save boundary then restores the previous file. Concurrent reloads are rejected to prevent interleaved configuration changes. Prometheus exposes `onebots_reloading` for alerting on unusually long reloads. Host-setting changes still return the fields that require a process restart.

By default, `onebots update` reads the current `config.yaml` `plugins` selection, so adapters and protocols added later through the Web extension center are included in version checks and updates. Explicit `-r` and `-p` values still override their respective categories; only legacy configurations without `plugins` fall back to the service installation snapshot. The updater queries only the target OneBots application version. When a newer application is available, it stages that package in a temporary directory with install scripts disabled, reads the extension-version catalog shipped inside it, and removes the temporary content. Every selected adapter and protocol then uses the exact version from that catalog instead of independently following npm `latest` and creating a combination that OneBots never verified together. A missing or malformed catalog entry, or a staging failure, stops before the production runtime is modified. For an installed service, the updater also captures an authoritative running state before the package manager writes anything; an unavailable control plane leaves packages, lockfiles, and the service definition unchanged. A successful package-manager exit is not accepted as proof by itself. The updater reads package manifests from the project runtime, falling back to the current OneBots installation root for a global CLI, and compares the actual version of the application and every selected plugin with those verified targets. Project-level npm updates save production dependencies with `--omit=dev`, so they do not restore development tooling in a production runtime. When npm is launched from pnpm, the updater also strips pnpm-only environment settings that npm does not support, preventing `_icqqjs-registry`, `recursive`, `store-dir`, and related warnings from obscuring diagnostics. npm and pnpm consistently use their `.cmd` entry points on Windows. When the package manager exits nonzero, the updater compares the complete package set, dependency declarations, and public and internal lockfile digests with its pre-command snapshot; any partial write restores every original version and rechecks package versions, dependency declarations, and lockfile digests. Any missing or mismatched package reports the complete expected/actual evidence and stops before service preflight, definition changes, or restart. Once every installed version is proven, `onebots update` launches the updated CLI in the service `workingDirectory` and runs a connection-free preflight with that same plugin list. It rewrites the service definition and optionally restarts only after every plugin loads and the configuration validates. After a restart, the command polls `/health` and `/ready` for a bounded period. Both responses must declare the same `onebots` application, target version, and `instance_id`; that instance must also differ from the one observed before restart, while readiness must succeed or remain in the first-run state that still permits configuration. Split proxy routing keeps the verifier retrying, and a timeout preserves both identities. Deferring an interactive restart now explicitly says that the updated packages are still served by the old process. A failed installed-version check or updated-runtime preflight leaves the current process running and preserves the existing service definition. Within that safe window, the updater uses the same npm or pnpm runtime to restore every selected package to its exact previous version, removes packages that did not previously exist, and verifies every result. An embedded caller that discovers a status-query failure only after dependencies were written uses the same transaction to restore them. If recovery also fails, the error preserves both the original problem and the recovery evidence for manual dependency and lockfile repair. Failures after the service definition or process switch has begun keep the new packages instead of blindly rolling back files used by a potentially running new instance.

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

If the port does not accept a loopback connection and no managed service is running, doctor also binds and immediately releases the port using the same listen mode as gateway startup. A conflict on another interface or IPv6, or insufficient bind permission, therefore becomes a `port` error instead of a false **available** result.

Every `/health` and `/ready` verifier reads at most 64 KiB of response body and checks both the declared `Content-Length` and the actual streamed byte count. An oversized response is cancelled immediately and becomes an explicit probe failure in doctor, status, and the start/restart/update online gates. The best-effort probe that records the old `instance_id` before a service switch uses the same boundary, so an unknown HTTP service on the configured port cannot consume CLI memory with a huge or endless response.

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
