# Docker Deployment

You can run the onebots gateway with Docker without installing Node.js on the host. The image is based on Node 24 Alpine for a small footprint.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed (and optionally [Docker Compose](https://docs.docker.com/compose/install/))

## Quick Start

### Option 1: Docker Compose (recommended)

Create a `docker-compose.yml` in your project directory. Recommended example (copy from the repo root or adjust as needed):

```yaml
# OneBots gateway - Docker Compose
# Usage: docker compose up -d
# Config and data persist in ./data

services:
  onebots:
    build: .
    image: onebots:latest
    container_name: onebots
    restart: unless-stopped
    ports:
      - "6727:6727"
    volumes:
      # Config and data (config.yaml, SQLite, logs)
      - ./data:/data
    environment:
      - NODE_ENV=production
```

To use the official pre-built image instead of building locally, remove `build: .` and set `image: ghcr.io/lc-cn/onebots:master`.

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
# Build image (from repository root)
docker build -t onebots .

# Run: publish port 6727 and mount config/data
docker run -d \
  --name onebots \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  onebots

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
| `/data/config.yaml` | Main config file; **must** be mounted for persistence and edits |
| `/data/data/`      | Database and audit logs; created by the app |

Mount a host directory to `/data` (e.g. `-v $(pwd)/data:/data`) so that:

- Config changes take effect after container restart
- Data and logs survive container removal

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

## Port and network

- Default gateway port is **6727** (configurable via `port` in `config.yaml`).
- When using `docker run`, match `-p` to the configured port (e.g. if `port: 8080`, use `-p 8080:8080`).

## Production tips

- Use **docker compose** or an orchestrator (e.g. Kubernetes) with a restart policy (`restart: unless-stopped` or equivalent).
- Back up the `/data` volume regularly (including `config.yaml` and the `data/` directory).
- If exposing publicly, put a reverse proxy (Nginx, Caddy, etc.) in front and enable HTTPS.
- Use `http://localhost:6727/health` and `/ready` for health checks; see [Production readiness](/en/guide/production).

## See also

- [Quick Start](/en/guide/start) — non-Docker install and run
- [Global config](/en/config/global) — configuration reference
- [Production readiness](/en/guide/production) — security, metrics, and health checks
