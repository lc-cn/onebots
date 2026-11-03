# Docker Deployment

Docker hosts the persistent OneBots manager without requiring Node.js on the host. The manager controls a separate gateway process, so Web management remains available when the gateway stops or fails. A new empty workspace requires explicit offline registration; until then it exposes a read-only maintenance page without pairing or business access.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed (and optionally [Docker Compose](https://docs.docker.com/compose/install/))

> Keep the image, entrypoint, and CLI on the same release. Legacy images do not implement this manager workflow; preserve the complete `/data` volume during upgrades and do not reuse legacy startup flags.

## Quick Start

### Option 1: Docker Compose (recommended)

Create a `docker-compose.yml` in your project directory. Persist **both `./data:/data` and a separate named authority volume**. Do not copy the authority with the business backup. The image and CLI must include workspace admission support.

```yaml
# OneBots gateway - Docker Compose (official image)
# Register the empty workspace offline before docker compose up -d.

services:
  onebots:
    image: ghcr.io/lc-cn/onebots:master
    container_name: onebots
    restart: unless-stopped
    ports:
      - "6727:6727"
    volumes:
      # Persist user config config.yaml and data (SQLite, logs)
      - ./data:/data
      - onebots-authority:/var/lib/onebots-authority
    environment:
      - NODE_ENV=production
      # Optional for deployments without a terminal; leave unset otherwise
      - ONEBOTS_BOOTSTRAP_CODE
    healthcheck:
      test: ["CMD", "node", "/app/scripts/docker-healthcheck.mjs"]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3

volumes:
  onebots-authority:
```

For a new empty workspace, keep the service stopped and save the plan outside `data/`:

```bash
umask 077
mkdir -p ./data
docker compose run --rm --no-deps -T onebots workspace plan \
  --data-dir /data --authority-dir /var/lib/onebots-authority/authority > onebots-plan.json
# Read the plan and revocation impact; substitute its actual digest.
docker compose run --rm --no-deps -T onebots workspace register \
  --plan-file - --confirm '<plan.digest>' < onebots-plan.json
# Registration does not start the manager or gateway.
docker compose up -d

# View logs
docker compose logs -f onebots

# Stop
docker compose down
```

The registered manager starts without platform accounts or protocol outputs. After it is running, pair a browser. Existing control v1 deployments need the [offline upgrade procedure](/guide/workspace-admission); do not reuse this fresh-install flow for an existing business directory or directly run strict-version `onebots migrate` on a monolithic legacy installation.

Authorize the browser with a device pairing code issued locally:

```bash
docker exec -u node onebots node /app/packages/onebots/lib/bin.js auth bootstrap --data-dir /data
```

Enter the returned code within five minutes on the pairing page to create a management session. If browser authorization is lost, issue a local code with `auth recover` instead; the previous session is invalidated only when that code is redeemed. Keep it private. Management authentication no longer uses a token in `config.yaml`, `ONEBOTS_ACCESS_TOKEN`, or the old username/password login. Protocol access tokens remain separate business settings. After source registration, deployments without an interactive terminal can pair with the one-time deployment Secret described in the HF section below; it does not authorize registration.

Use Web or TUI to select extensions, review the installation plan, install and verify a candidate generation, then explicitly activate it. Configure accounts and protocol connections separately; choosing a framework does not automatically enable a protocol. Configuration changes use validation and explicit application, with the management service remaining available during gateway restarts.

The deployment code in `.env.example` is commented out by default; do not set it to an empty string. Normal local deployments can use `auth bootstrap` without this environment variable.

### Container user and volume permissions

The entrypoint assigns only a **truly empty** `/data` mount point to the built-in `node` user (uid/gid `1000`) when started as root, then drops privileges with `su-exec`. Existing workspace contents and ownership are not recursively repaired. The independent authority mount initializes only a new private `authority` subdirectory; invalid existing permissions cause failure without repair.

If access checks fail, stop the service and inspect the original volume offline. An explicit Docker `--user` or Compose `user:` is preserved and must already have access to both stores. Installed dependencies and verified generations remain under `/data/.control`; do not use the old `/data/extensions` or `ONEBOTS_EXTENSION_ROOT` mechanism.

### Container health status

The health check probes the management service at `http://127.0.0.1:${PORT:-6727}/ready`; it does not derive an address from business YAML. It validates the application/version identity, `ready: true`, response size and deadline, and rejects redirects. Inspect it with:

```bash
docker compose ps
docker inspect --format '{{json .State.Health}}' onebots
```

Management readiness is separate from gateway and account health. An empty or stopped gateway, or damaged configuration, must not make the management console unavailable. Inspect gateway state in Web or with `onebots doctor --data-dir /data`. Docker restart policies do not restart containers solely because a health check fails.

### Option 2: docker run

First complete offline plan and registration using the same two mounts, as shown in the [repository quick start](https://github.com/lc-cn/onebots/blob/master/README.en.md#a-docker-recommended). Then run the registered workspace:

```bash
# Use the same data and named authority volume as registration.
docker run -d \
  --name onebots \
  --restart unless-stopped \
  -p 6727:6727 \
  -v "$(pwd)/data:/data" \
  -v onebots-authority:/var/lib/onebots-authority \
  ghcr.io/lc-cn/onebots:master

# View logs
docker logs -f onebots

# Stop and remove
docker stop onebots && docker rm onebots
```

## Using pre-built images from GitHub

Published images are available through [GitHub Actions](https://github.com/lc-cn/onebots/actions). Use a release containing workspace admission support, and pin its tag or digest in production. After offline registration, reuse the same two mounts:

```bash
docker run -d \
  --name onebots \
  --restart unless-stopped \
  -p 6727:6727 \
  -v "$(pwd)/data:/data" \
  -v onebots-authority:/var/lib/onebots-authority \
  ghcr.io/lc-cn/onebots:master
```

An older tag without the registration capability cannot follow this startup flow; do not fall back to its legacy entrypoint.

## Data and configuration

| Path (in container) | Description |
|---------------------|-------------|
| `/data/config.yaml` | User config file; **must** be mounted or it is lost on container restart |
| `/data/data/`       | Database and audit logs; created by the app |
| `/data/.control/` | Management authentication, operations and verified dependency generations; not a portable backup format |
| `/var/lib/onebots-authority/authority` | Private source registry and per-workspace locks, on a separate persistent mount |

**Always** preserve `/data` and the independent authority mount. The data mount preserves:

- User config `config.yaml` is persisted on the host and survives restarts or rebuilds
- Database and logs are not lost when the container is removed
- Adapters and protocols installed by the extension center survive container recreation

On the same persistent volume, a graceful `docker compose down` followed by `docker compose up -d` does not require a fixed hostname. A new container may claim a valid `closed` ownership receipt only when the gateway is stopped, no unresolved gateway instance remains, and worker checks pass. The gateway's running/stopped intent, configuration, and management authentication are preserved.

A forced stop, host failure, or incomplete shutdown can leave an `active` receipt. If the hostname also changes, preserve diagnostic access without assuming old processes have exited. Run `docker exec --user 1000:1000 onebots node /app/packages/onebots/lib/bin.js doctor --data-dir /data --authority-dir /var/lib/onebots-authority/authority --json --strict`; do not delete or edit `.control/process-ownership.json` to bypass the check. Same-volume recreation does not prove migration ownership on another host.

**Copying `.control` across hosts is unsupported, even with a `closed` receipt.** The strict version checks the external authority and physical directory identity, so an ordinary data-volume copy cannot silently acquire runtime rights. This is not global exclusion between authority or machine clones, and does not provide cross-host HA.

Before manually transferring business configuration, the target must independently complete a new empty-workspace registration, then configure and install/verify extensions through its manager. An existing business directory cannot be treated as fresh registration. Confirm that the source instance and its managed processes have stopped; do not copy `.control`, authority or old `/data/extensions` as the target runtime. This is not a complete archive-import, forced-takeover or global-fencing workflow. See [workspace registration and offline upgrade](/guide/workspace-admission).

Retained download or configuration-verification worker records from the old hostname still block takeover, even when the manager receipt is `closed`. A matching PID in the new container cannot prove the historical worker has exited. Preserve these records for operator inspection; do not remove them or bypass hostname checks to force recovery.

## Custom adapters and protocols

The empty manager does not preselect adapters or protocols. Install the required packages and their required peers through the management installation workflow, verify the candidate, and activate it explicitly. Do not replace the Docker command with legacy `-c/-r/-p` startup flags.

### Private dependencies such as ICQQ

Supply required package-download authorization through the installation workflow. Do not bake private tokens into image layers, command arguments or business configuration. Downloading a candidate is not installation success: validation must pass before activation.

## Port and network

- The management listener defaults to **6727**. Set `PORT` and map the corresponding container port when changing it.
- Business YAML does not determine the manager listener. HF uses **7860** without rewriting YAML.

## Hugging Face template and support boundary

`Dockerfile.hf` retains port **7860**, deployment pairing codes, and standalone archive tools. It does **not** mean the HF storage provider has been validated. HF supports [one or more Storage Buckets mounted at custom paths](https://huggingface.co/docs/hub/spaces-storage), but stable physical directory identity, reliable SQLite local locks, and persistence barriers on those mounts remain unverified. Bucket/FUSE paths are not accepted as reliable local volumes. Local OrbStack virtiofs tests do not prove cloud bucket behavior.

A deployment using this template must supply two independent, reliable local persistent volumes at `/data` and `/var/lib/onebots-authority`, perform an offline workspace plan and explicit registration, and only then start and pair. The local Docker acceptance uses named volumes; it is not an HF cloud or bucket acceptance. Keep `docker-entrypoint-hf.sh`, `docker-workspace.sh`, `docker-authority.sh` and both archive scripts in the same version as the base image. Missing authority storage is an explicit startup error.

**Automatic `HF_REPO_ID` restoration is disabled for this first release.** Any nonempty value causes the entrypoint to exit before downloading, initializing either directory, changing ownership, or writing data. Remove the variable to continue the normal registration and startup flow. A controlled restore flow will be delivered separately; neither restoring before registration nor ignoring `.control` is a supported workaround.

The standalone `hf-repository-download.mjs` and `hf-data-archive-restore.mjs` tools remain available. Their presence does not make an archive eligible for first registration or for overwriting a registered workspace. Backups must exclude `.control`, authority data, dependencies, and download credentials. Preserve backups until a supported import flow is available; do not restore management sessions or PID receipts, and never upload plaintext account state to a public repository. Existing `.hf-restore-*` or download temporary markers still block startup without cleanup or automatic retries.

`HF_TOKEN` is removed before starting the manager or gateway. Initial pairing and recovery codes retain the same limited lifetime and one-use behavior as the standard manager. `PORT` controls the manager listener and defaults to 7860; it does not rewrite business YAML or DNS.

## Production tips

- Use **docker compose** or an orchestrator (e.g. Kubernetes) with a restart policy (`restart: unless-stopped` or equivalent).
- Back up the `/data` volume regularly (including `config.yaml` and the `data/` directory).
- If exposing publicly, put a reverse proxy (Nginx, Caddy, etc.) in front and enable HTTPS.
- Use `http://localhost:6727/healthz` and `/ready` for health checks; see [Production readiness](/en/guide/production).

## See also

- [Quick Start](/en/guide/start) — non-Docker install and run
- [Global config](/en/config/global) — configuration reference
- [Production readiness](/en/guide/production) — security, metrics, and health checks
