# Production deployment

Production OneBots consists of a persistent manager service, an on-demand gateway process, and operating-system supervision. CLI, TUI, and Web all perform installation, configuration, upgrades, and lifecycle operations through the manager. The manager and Web console must remain available after the gateway stops.

## Install the service

Choose a persistent, permission-restricted workspace. Do not place configuration or runtime versions in a temporary directory.

```bash
# User service
onebots install --data-dir /srv/onebots
onebots start

# Linux system service
sudo onebots install --system --data-dir /var/lib/onebots
sudo onebots start --system
```

`install` creates the manager service definition and immutable runtime candidate. It does not prefill accounts, protocols, or platform credentials and does not connect a platform. In Docker, run `onebots serve --data-dir /data` as the foreground container process and persist `/data`; do not install another system service inside the container.

Run `onebots migrate` for an old deployment. Migration inspects the old service definition, data directory, and configuration and creates a recoverable operation record. Do not overwrite an old service definition directly.

## Manager authentication

The manager only accepts device pairing and revocable device sessions. Issue the first one-time code on the manager host:

```bash
onebots auth bootstrap --data-dir /srv/onebots
```

Deliver the code over a trusted operator channel and redeem it before expiry. Adding a browser or recovering access also begins on the manager host:

```bash
onebots auth device --data-dir /srv/onebots
onebots auth recover --data-dir /srv/onebots
```

Root `username`, `password`, and `access_token` fields in business configuration are not manager credentials and are excluded from the gateway configuration snapshot.

Protocol `access_token`, `token`, and HMAC secret values for OneBot, Milky, Satori, MCP, and other outputs remain business configuration. They protect only their API, event transport, or callback and require independent generation, minimum scope, and rotation.

## Install extensions

Create an installation plan in Web or TUI and select platform adapters, output protocols, and framework extensions. The plan resolves the package, required peer dependencies, download authorization, and target runtime version.

```bash
onebots ui --data-dir /srv/onebots
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
onebots doctor --data-dir /srv/onebots --json --strict
onebots control start --data-dir /srv/onebots
onebots control status --data-dir /srv/onebots
```

Use `doctor --strict` as a deployment gate. It checks workspace permissions, the active runtime version, plugin entries and registration contracts, configuration schemas, database paths, and service state. Validate real platform credentials separately in the target environment.

Gateway lifecycle commands keep the manager running:

```bash
onebots control stop --data-dir /srv/onebots
onebots control restart --data-dir /srv/onebots
```

Use `onebots stop`, `restart`, and `uninstall` only for manager or system-definition maintenance. Uninstalling the service must preserve the workspace, account configuration, and operation records.

## Network and credentials

- Expose the manager only on a trusted network by default. Put cross-host access behind a TLS reverse proxy or controlled tunnel.
- Restrict filesystem access to the workspace, device sessions, platform secrets, and temporary npm credentials.
- Use a separate token for each protocol output. Do not reuse pairing material or platform credentials.
- Enable HMAC or protocol-required callback verification and constrain destinations and retry policy.
- Keep real credentials out of images, repositories, command history, build logs, and diagnostic bundles.

## Operations and recovery

```bash
onebots status --json
onebots logs
onebots update --check --data-dir /srv/onebots
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
