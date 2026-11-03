# Production deployment

Production OneBots consists of a persistent manager service, an on-demand gateway process, and operating-system supervision. CLI, TUI, and Web all perform installation, configuration, upgrades, and lifecycle operations through the manager. The manager and Web console must remain available after the gateway stops.

## Install the service

Choose a persistent, permission-restricted workspace. Do not place configuration or runtime versions in a temporary directory.

```bash
# New Linux/macOS user service, with separate persistent directories.
umask 077
onebots install --data-dir "$HOME/onebots-data" --authority-dir "$HOME/onebots-authority"
onebots workspace plan --data-dir "$HOME/onebots-data" \
  --authority-dir "$HOME/onebots-authority" > "$HOME/onebots-plan.json"
# Read the plan and its revocation impact; substitute the actual digest.
onebots workspace register --plan-file "$HOME/onebots-plan.json" --confirm '<plan.digest>'
onebots start
```

`install` creates the service definition and immutable runtime candidate, leaving the service stopped. Registration does not start the manager or gateway; explicitly confirm it before `start`, then pair devices. The workspace and authority must not contain each other, and the plan file stays outside the workspace. Reuse the original authority for a registered workspace without registering again. Linux system services require `--system` and the appropriate administrator permissions; choose persistent paths using the installer output. On Windows, use the [elevated installer](/en/guide/start#bootstrap-installation) to prepare private ACLs.

In Docker, run `onebots serve --data-dir /data --authority-dir /var/lib/onebots-authority/authority` and persist `/data` and `/var/lib/onebots-authority` as separate mounts. Confirm offline registration before normal startup; do not install another system service in the container. See the [Docker guide](/en/guide/docker).

Existing control v1 services require the [offline upgrade procedure](/guide/workspace-admission). Earlier monolithic legacy deployments cannot directly run strict-version `onebots migrate`; use a compatible migration stage first. Do not overwrite old service definitions or start an old binary to bypass admission.

## Manager authentication

The manager only accepts device pairing and revocable device sessions. Issue the first one-time code on the manager host:

```bash
onebots auth bootstrap --data-dir "$HOME/onebots-data"
```

Deliver the code over a trusted operator channel and redeem it before expiry. Adding a browser or recovering access also begins on the manager host:

```bash
onebots auth device --data-dir "$HOME/onebots-data"
onebots auth recover --data-dir "$HOME/onebots-data"
```

Root `username`, `password`, and `access_token` fields in business configuration are not manager credentials and are excluded from the gateway configuration snapshot.

Protocol `access_token`, `token`, and HMAC secret values for OneBot, Milky, Satori, MCP, and other outputs remain business configuration. They protect only their API, event transport, or callback and require independent generation, minimum scope, and rotation.

## Install extensions

Create an installation plan in Web or TUI and select platform adapters, output protocols, and framework extensions. The plan resolves the package, required peer dependencies, download authorization, and target runtime version.

```bash
onebots ui --data-dir "$HOME/onebots-data"
```

Use these production boundaries:

1. Generate and confirm the installation plan.
2. Download into an isolated candidate directory without storing private registry tokens in image layers, logs, or business configuration.
3. Validate package entries, schemas, registration contracts, and artifact boundaries.
4. Explicitly activate the verified immutable candidate.
5. Configure accounts and protocols, then validate and apply the revision.
6. Start or restart the gateway through the manager.

Installation, activation, configuration, and startup are separate operations. A failure must not replace the active version. Inject a private package token only through a temporary npm configuration for the installation operation, then remove it.

## Configure and start

Before any platform connection, OneBots validates configuration against schemas from the active extensions. An invalid draft cannot replace active configuration. If runtime application fails, the file and running state return to the previous revision.

```bash
onebots doctor --data-dir "$HOME/onebots-data" --authority-dir "$HOME/onebots-authority" --json --strict
onebots control start --data-dir "$HOME/onebots-data"
onebots control status --data-dir "$HOME/onebots-data"
```

Use `doctor --strict` as a deployment gate. It checks workspace permissions, the active runtime version, plugin entries and registration contracts, configuration schemas, database paths, and service state. Validate real platform credentials separately in the target environment.

Gateway lifecycle commands keep the manager running:

```bash
onebots control stop --data-dir "$HOME/onebots-data"
onebots control restart --data-dir "$HOME/onebots-data"
```

Use `onebots stop`, `restart`, and `uninstall` only for manager or system-definition maintenance. Uninstalling the service must preserve the workspace, account configuration, and operation records.

## Network and credentials

- Expose the manager only on a trusted network by default. Put cross-host access behind a TLS reverse proxy or controlled tunnel.
- Restrict filesystem access to the workspace, device sessions, platform secrets, and temporary npm credentials.
- Use a separate token for each protocol output. Do not reuse pairing material or platform credentials.
- Enable HMAC or protocol-required callback verification and constrain destinations and retry policy.
- Keep real credentials out of images, repositories, command history, build logs, and diagnostic bundles.

### Submitting secrets behind an HTTPS proxy

Remote HTTP pages may manage non-secret settings, but cannot submit platform credentials, protocol tokens or private registry credentials. Use HTTPS. By default the manager accepts secrets over loopback connections. If your TLS proxy connects over a container network or another host, set its actual source IP in the **manager process environment** (comma-separated for multiple proxies):

```bash
ONEBOTS_TRUSTED_PROXY_ADDRESSES=172.18.0.2 onebots serve \
  --data-dir "$HOME/onebots-data" --authority-dir "$HOME/onebots-authority"
```

This foreground example requires stopping the same registered system service normally first. Reuse its authority; do not run both managers or register again.

For Docker, pass `-e ONEBOTS_TRUSTED_PROXY_ADDRESSES=172.18.0.2`. For an OS service, configure its runtime environment and restart the manager. Use the IPv4/IPv6 source address seen by the manager; hostnames, wildcards, subnets and scoped IPv6 addresses are rejected. The proxy must overwrite `X-Forwarded-Proto` with a single `https` value for HTTPS requests (for example, Nginx `proxy_set_header X-Forwarded-Proto $scheme;`), never forward a client-supplied value, and preserve the original `Host`. Trust only proxies you control and restrict network access between them and the manager. Direct local HTTP connections require a loopback Host (localhost, 127.0.0.0/8 or ::1). Even a proxy on the same machine must overwrite X-Forwarded-Proto with a single https value and preserve the original Host; plaintext or missing declarations cannot submit secrets. This grants no local terminal, authentication bootstrap or private control privileges.

## Operations and recovery

```bash
onebots status --json
onebots logs
onebots update --check --data-dir "$HOME/onebots-data"
```

Installation, migration, update, and configuration apply operations should expose a queryable operation ID. After an interruption or unknown result, inspect the operation record and recover before repeating an external install or switch:

```bash
onebots recover --operation <operation-id>
```

Back up configuration, device authorization state, the database, the active runtime reference, and operation records. A recovery exercise should prove that the manager starts independently when the gateway fails and can return to the previous verified runtime.

## Release checklist

- The target operating system supervises the manager and restarts it after failure.
- Device pairing can log in to Web and retired manager credentials cannot.
- Manager, Web, and control commands remain available after the gateway stops.
- The active version contains only verified adapter, protocol, and framework artifacts.
- Strict configuration validation passes and a real platform account connects successfully.
- Authentication and event delivery pass for every enabled HTTP, WebSocket, callback, or SSE transport.
- Logs, disk, ports, database, and operation records have monitoring and backups.
- Failed updates and process interruptions can roll back or recover without changing the data directory.

## Related documentation

- [Global configuration](/en/config/global)
- [Docker deployment](/en/guide/docker)
- [Troubleshooting](/en/troubleshooting/)
