# Docker Deployment

You can run the onebots gateway with Docker without installing Node.js on the host. The image is based on Node 24 Alpine for a small footprint.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed (and optionally [Docker Compose](https://docs.docker.com/compose/install/))

> This architecture branch has not yet been published to the `master` image. Build this checkout with `docker build -t onebots-manager .` and use that matching image in the examples below. Do not combine the new entrypoint with an older image.

## Quick Start

### Option 1: Docker Compose (recommended)

Create a `docker-compose.yml` in your project directory. **You must mount `./data` to `/data`** so that user config (`config.yaml`) and data are persisted; otherwise they are lost when the container restarts.

```yaml
# OneBots gateway - Docker Compose (official image)
# Usage: docker compose up -d
# Mount ./data to persist user config.yaml and data

services:
  onebots:
    image: onebots-manager # Build this architecture checkout first
    container_name: onebots
    restart: unless-stopped
    ports:
      - "6727:6727"
    volumes:
      # Persist user config config.yaml and data (SQLite, logs)
      - ./data:/data
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
```

Then run:

```bash
# Start (runs in background; config and data are in ./data)
docker compose up -d

# View logs
docker compose logs -f onebots

# Stop
docker compose down
```

The container runs a persistent management service, which owns the gateway subprocess. An empty workspace starts without platform accounts or protocol outputs. A damaged business configuration does not remove access to the management console.

Authorize the browser with a device pairing code issued locally:

```bash
docker exec -u node onebots node /app/packages/onebots/lib/bin.js auth bootstrap --data-dir /data
```

Enter the returned code within five minutes on the pairing page to create a management session. If browser authorization is lost, issue a local code with `auth recover` instead; the previous session is invalidated only when that code is redeemed. Keep it private. Management authentication no longer uses a token in `config.yaml`, `ONEBOTS_ACCESS_TOKEN`, or the old username/password login. Protocol access tokens remain separate business settings. Without a terminal, use the one-time deployment Secret described in the HF section below.

Use Web or TUI to select extensions, review the installation plan, install and verify a candidate generation, then explicitly activate it. Configure accounts and protocol connections separately; choosing a framework does not automatically enable a protocol. Configuration changes use validation and explicit application, with the management service remaining available during gateway restarts.

The deployment code in `.env.example` is commented out by default; do not set it to an empty string. Normal local deployments can use `auth bootstrap` without this environment variable.

### Container user and volume permissions

The entrypoint creates `/data` if needed, assigns it to the built-in `node` user (uid/gid `1000`) when started as root, then drops privileges with `su-exec`. The manager and gateway do not remain running as root. Existing volume ownership may change to `1000:1000`.

If ownership changes fail, startup stops. An explicit Docker `--user` or Compose `user:` is preserved and must already have access to the workspace. Installed dependencies and verified generations are managed under `/data/.control`; do not use the old `/data/extensions` or `ONEBOTS_EXTENSION_ROOT` mechanism.

### Container health status

The health check probes the management service at `http://127.0.0.1:${PORT:-6727}/ready`; it does not derive an address from business YAML. It validates the application/version identity, `ready: true`, response size and deadline, and rejects redirects. Inspect it with:

```bash
docker compose ps
docker inspect --format '{{json .State.Health}}' onebots
```

Management readiness is separate from gateway and account health. An empty or stopped gateway, or damaged configuration, must not make the management console unavailable. Inspect gateway state in Web or with `onebots doctor --data-dir /data`. Docker restart policies do not restart containers solely because a health check fails.

### Option 2: docker run

```bash
# Run official image (use -v to persist user config)
docker run -d \
  --name onebots \
  --restart unless-stopped \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  onebots-manager

# View logs
docker logs -f onebots

# Stop and remove
docker stop onebots && docker rm onebots
```

## Using pre-built images from GitHub

Published images are available through [GitHub Actions](https://github.com/lc-cn/onebots/actions), but the current `master` image does not yet provide this branch's management architecture. Use the local build below until the corresponding release is published:

```bash
# Build the matching checkout
docker build -t onebots-manager .

# Run
docker run -d \
  --name onebots \
  --restart unless-stopped \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  onebots-manager
```

Released versions use version tags, e.g. `ghcr.io/lc-cn/onebots:1.0.0`.

## Data and configuration

| Path (in container) | Description |
|---------------------|-------------|
| `/data/config.yaml` | User config file; **must** be mounted or it is lost on container restart |
| `/data/data/`       | Database and audit logs; created by the app |
| `/data/.control/` | Management authentication, operations and verified dependency generations; not a portable backup format |

**Always** mount a host directory to `/data` (e.g. `-v $(pwd)/data:/data` or `./data:/data` in docker-compose) so that:

- User config `config.yaml` is persisted on the host and survives restarts or rebuilds
- Database and logs are not lost when the container is removed
- Adapters and protocols installed by the extension center survive container recreation

## Custom adapters and protocols

The empty manager does not preselect adapters or protocols. Install the required packages and their required peers through the management installation workflow, verify the candidate, and activate it explicitly. Do not replace the Docker command with legacy `-c/-r/-p` startup flags.

### Private dependencies such as ICQQ

Supply required package-download authorization through the installation workflow. Do not bake private tokens into image layers, command arguments or business configuration. Downloading a candidate is not installation success: validation must pass before activation.

## Port and network

- The management listener defaults to **6727**. Set `PORT` and map the corresponding container port when changing it.
- Business YAML does not determine the manager listener. HF uses **7860** without rewriting YAML.

## Deploy to Hugging Face Spaces

The repo includes Docker files for [Hugging Face Spaces](https://huggingface.co/docs/hub/spaces-sdks-docker): they use port **7860** (HF default) and do not require building from source on HF.

**Steps:**

1. Create a Space on Hugging Face and choose **Docker** as the SDK.
2. In the Space repo, add these four files (copy from this repo and preserve the `scripts/` subdirectory):
   - **Dockerfile**: copy from `Dockerfile.hf` (or rename `Dockerfile.hf` to `Dockerfile`).
   - **docker-entrypoint-hf.sh**: the entrypoint script next to `Dockerfile.hf`.
   - **scripts/hf-repository-download.mjs**: the bounded restore downloader; keep its path aligned with the `COPY` instruction in the Dockerfile.
   - **scripts/hf-data-archive-restore.mjs**: the data archive inspector and isolated restorer; preserve this relative path as well.
3. In Space → **Settings** → **Secrets**, add `ONEBOTS_BOOTSTRAP_CODE`. Generate 32 random bytes as a 43-character base64url code with `node --input-type=module -e "import { randomBytes } from 'node:crypto'; process.stdout.write(randomBytes(32).toString('base64url'))"`. Enter it on the pairing page within five minutes of startup. Never put it in public Variables; remove the Secret after pairing.
4. To persist config and data, see **Mounting and viewing /data on HF** below.

`Dockerfile.hf` is based on the official image `ghcr.io/lc-cn/onebots:master` and only adds the HF port, entrypoint, and two dependency-free restore boundaries, so builds are fast and no GitHub Packages build secret is needed.

The deployment code only authorizes initial pairing. Only its digest is persisted; the code is removed from the manager environment and is not passed to the gateway. Restarting with the same code does not extend its expiry. Before pairing, you may rotate to a fresh random code and restart, with at most 16 distinct deployment codes. An existing paired session is never replaced by this Secret. With terminal access, use local `onebots auth recover`. Without it, remove the old `ONEBOTS_BOOTSTRAP_CODE` Secret, generate a fresh random code using the command above, save it as the private `ONEBOTS_RECOVERY_CODE` Secret, and restart. Enter it on the pairing page within five minutes, then remove the Secret. Only successful redemption revokes the old session. Restarting cannot reissue or extend the same code. Recovery cannot initialize an unpaired workspace; do not set both Secrets or reuse an earlier deployment code. An unexpired local recovery code takes priority; use it or wait until it expires before injecting another fresh deployment code. At most 16 recovery codes are recorded; beyond that use local recovery, never delete authentication files to bypass the limit. There is no permanent deployment-token login.

Use a base image built from this architecture branch until it is released. Pass `--build-arg ONEBOTS_BASE_IMAGE=<matching-image>` when building `Dockerfile.hf`.

### Mounting and viewing persistent /data on HF

- **Mount**: Hugging Face mounts persistent storage at **`/data`** at **runtime** (same path OneBots uses). You do not add a `VOLUME` or mount in the Dockerfile.  
  1. Open your Space → **Settings** → **Storage** (or Billing / storage).  
  2. If **Persistent storage** is available, enable it; the platform will attach the volume to `/data`.  
  3. If persistent storage is not offered for your account/region, anything under `/data` is lost on Space restart; back up important config to a [Dataset](https://huggingface.co/docs/hub/spaces-storage#dataset-storage) or external store.

- **View**: HF does not provide a file browser for the container’s `/data`. The Space **Files** tab shows only the repo (Dockerfile, scripts), not the runtime volume.  
  - After pairing, use the OneBots configuration interface to inspect and edit configuration.
  - On first run without persistent storage, the entrypoint creates a default `config.yaml` under `/data`; it will persist across restarts only if persistent storage is enabled.

### Restoring an existing backup

Prefer persistent storage. The new manager has **not** integrated the old automatic “save in Web and upload to the Space repository” backup workflow. Do not assume a backup exists, and never upload plaintext configuration or account databases to a public repository.

Set `HF_REPO_ID` to restore an existing backup; use a read-only `HF_TOKEN` Secret for private repository downloads. The entrypoint attempts `data_backup.tar.gz` only when `/data` is completely empty, and tries `config_backup.yaml` if no archive was obtained. Existing volumes are never overwritten by a remote snapshot. No backup or damaged YAML still leaves the manager available for configuration repair.

Portable archives may contain `config.yaml`, account state and databases under `data/`, and `static/`. They must exclude `.control`, dependencies, package credentials, caches and temporary state. Do not restore management sessions, historical PIDs or verified-generation receipts. Reinstall and verify extensions through the manager after restoration. Stop the gateway and confirm its exit before backing up databases; copying live SQLite files is not proof of a consistent backup.

Restore retains limits of 15 MiB compressed, 128 MiB expanded and 10,000 entries, rejects traversal and links, and uses private staging. A downloaded archive that fails validation or restoration stops startup instead of falling back to configuration. Any residual `.hf-restore-*` blocks startup: preserve the volume and inspect the failure; restore into a fresh empty volume after confirming no process is running. Do not repeatedly restart or simply remove the marker.

`PORT` sets the manager listener, defaulting to 7860. The entrypoint neither rewrites business YAML nor replaces system DNS. Diagnose DNS and outbound access in the deployment environment.

```bash
docker build -t onebots-manager .
docker build -f Dockerfile.hf --build-arg ONEBOTS_BASE_IMAGE=onebots-manager -t onebots-hf .
docker run -p 7860:7860 -v $(pwd)/data:/data onebots-hf
```

## Production tips

- Use **docker compose** or an orchestrator (e.g. Kubernetes) with a restart policy (`restart: unless-stopped` or equivalent).
- Back up the `/data` volume regularly (including `config.yaml` and the `data/` directory).
- If exposing publicly, put a reverse proxy (Nginx, Caddy, etc.) in front and enable HTTPS.
- Use `http://localhost:6727/healthz` and `/ready` for health checks; see [Production readiness](/en/guide/production).

## See also

- [Quick Start](/en/guide/start) — non-Docker install and run
- [Global config](/en/config/global) — configuration reference
- [Production readiness](/en/guide/production) — security, metrics, and health checks
