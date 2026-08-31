# Docker Deployment

You can run the onebots gateway with Docker without installing Node.js on the host. The image is based on Node 24 Alpine for a small footprint.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed (and optionally [Docker Compose](https://docs.docker.com/compose/install/))

## Quick Start

### Option 1: Docker Compose (recommended)

Create a `docker-compose.yml` in your project directory. **You must mount `./data` to `/data`** so that user config (`config.yaml`) and data are persisted; otherwise they are lost when the container restarts.

```yaml
# OneBots gateway - Docker Compose (official image)
# Usage: docker compose up -d
# Mount ./data to persist user config.yaml and data

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
    environment:
      - NODE_ENV=production
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

On first run, a `./data` directory is created and a default `config.yaml` is generated. Edit `./data/config.yaml` as needed, then run `docker compose restart` to apply changes.

### Option 2: docker run

```bash
# Run official image (use -v to persist user config)
docker run -d \
  --name onebots \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  ghcr.io/lc-cn/onebots:master

# View logs
docker logs -f onebots

# Stop and remove
docker stop onebots && docker rm onebots
```

## Using pre-built images from GitHub

If the repo uses [GitHub Actions to build Docker images](https://github.com/lc-cn/onebots/actions), you can pull from GHCR instead of building locally:

```bash
# Pull latest
docker pull ghcr.io/lc-cn/onebots:master

# Run
docker run -d \
  --name onebots \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  ghcr.io/lc-cn/onebots:master
```

Released versions use version tags, e.g. `ghcr.io/lc-cn/onebots:1.0.0`.

## Data and configuration

| Path (in container) | Description |
|---------------------|-------------|
| `/data/config.yaml` | User config file; **must** be mounted or it is lost on container restart |
| `/data/data/`       | Database and audit logs; created by the app |

**Always** mount a host directory to `/data` (e.g. `-v $(pwd)/data:/data` or `./data:/data` in docker-compose) so that:

- User config `config.yaml` is persisted on the host and survives restarts or rebuilds
- Database and logs are not lost when the container is removed

## Custom adapters and protocols

The image registers common adapters and protocols by default. To use only specific platforms, override the default command:

```bash
docker run -d \
  --name onebots \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  onebots \
  -c /data/config.yaml -r qq -r wechat -p onebot-v11 -p onebot-v12
```

Same as CLI: `-r` for adapters (repeatable), `-p` for protocols (repeatable), `-c` for config path.

### Official image and ICQQ (unofficial QQ protocol)

**Official GHCR images do not include** `adapter-icqq` or its dependency `@icqqjs/icqq`: the repo root `.dockerignore` excludes `adapters/adapter-icqq`, and the Docker build no longer uses a GitHub Packages build secret. The image therefore has **no** ICQQ adapter, and the default startup command **does not** pass `-r icqq`.

If you still need ICQQ in a container, **build your own image from the full source tree** (do not exclude that directory) and supply npm credentials that can resolve `@icqqjs/icqq`, and assess compliance yourself. For typical use, prefer the **QQ Open Platform** adapter (`-r qq`).

## Port and network

- Default gateway port is **6727** (configurable via `port` in `config.yaml`).
- When using `docker run`, match `-p` to the configured port (e.g. if `port: 8080`, use `-p 8080:8080`).

## Deploy to Hugging Face Spaces

The repo includes Docker files for [Hugging Face Spaces](https://huggingface.co/docs/hub/spaces-sdks-docker): they use port **7860** (HF default) and do not require building from source on HF.

**Steps:**

1. Create a Space on Hugging Face and choose **Docker** as the SDK.
2. In the Space repo, add these two files (copy from this repo):
   - **Dockerfile**: copy from `Dockerfile.hf` (or rename `Dockerfile.hf` to `Dockerfile`).
   - **docker-entrypoint-hf.sh**: the entrypoint script next to `Dockerfile.hf`.
3. To persist config and data, see **Mounting and viewing /data on HF** below.

`Dockerfile.hf` is based on the official image `ghcr.io/lc-cn/onebots:master` and only adds the HF port and entrypoint, so builds are fast and no GitHub Packages build secret is needed.

### Mounting and viewing persistent /data on HF

- **Mount**: Hugging Face mounts persistent storage at **`/data`** at **runtime** (same path OneBots uses). You do not add a `VOLUME` or mount in the Dockerfile.  
  1. Open your Space → **Settings** → **Storage** (or Billing / storage).  
  2. If **Persistent storage** is available, enable it; the platform will attach the volume to `/data`.  
  3. If persistent storage is not offered for your account/region, anything under `/data` is lost on Space restart; back up important config to a [Dataset](https://huggingface.co/docs/hub/spaces-storage#dataset-storage) or external store.

- **View**: HF does not provide a file browser for the container’s `/data`. The Space **Files** tab shows only the repo (Dockerfile, scripts), not the runtime volume.  
  - To inspect or back up: use OneBots’ web UI if it exposes config/state, or add a read-only API in your app (e.g. list files under `/data`, serve `config.yaml`).  
  - On first run without persistent storage, the entrypoint creates a default `config.yaml` under `/data`; it will persist across restarts only if persistent storage is enabled.

Test the HF image locally (port 7860):

```bash
docker build -f Dockerfile.hf -t onebots-hf .
docker run -p 7860:7860 -v $(pwd)/data:/data onebots-hf
```

## Production tips

- Use **docker compose** or an orchestrator (e.g. Kubernetes) with a restart policy (`restart: unless-stopped` or equivalent).
- Back up the `/data` volume regularly (including `config.yaml` and the `data/` directory).
- If exposing publicly, put a reverse proxy (Nginx, Caddy, etc.) in front and enable HTTPS.
- Use `http://localhost:6727/health` and `/ready` for health checks; see [Production readiness](/en/guide/production).

## See also

- [Quick Start](/en/guide/start) — non-Docker install and run
- [Global config](/en/config/global) — configuration reference
- [Production readiness](/en/guide/production) — security, metrics, and health checks
