# Docker 部署

通过 Docker 可以快速部署 onebots 网关，无需在宿主机安装 Node.js。镜像基于 Node 24 Alpine，体积较小。

## 前置要求

- 已安装 [Docker](https://docs.docker.com/get-docker/)（及可选 [Docker Compose](https://docs.docker.com/compose/install/)）

## 快速开始

### 方式一：使用 Docker Compose（推荐）

在项目目录下创建 `docker-compose.yml`，推荐内容如下（可从仓库根目录复制或按需修改）：

```yaml
# OneBots 网关 - Docker Compose
# 使用：docker compose up -d
# 配置与数据持久化在 ./data 目录

services:
  onebots:
    build: .
    image: onebots:latest
    container_name: onebots
    restart: unless-stopped
    ports:
      - "6727:6727"
    volumes:
      # 配置与数据持久化（config.yaml、SQLite、日志等）
      - ./data:/data
    environment:
      - NODE_ENV=production
```

若使用官方预构建镜像、不本地构建，可将 `build: .` 去掉，并设置 `image: ghcr.io/lc-cn/onebots:master`。

然后执行：

```bash
# 启动（后台运行，配置与数据持久化在 ./data）
docker compose up -d

# 查看日志
docker compose logs -f onebots

# 停止
docker compose down
```

首次运行会在当前目录下创建 `./data`，并在其中生成默认 `config.yaml`。修改 `./data/config.yaml` 后执行 `docker compose restart` 使配置生效。

### 方式二：使用 docker run

```bash
# 构建镜像（在仓库根目录执行）
docker build -t onebots .

# 运行容器：映射端口 6727，挂载配置与数据目录
docker run -d \
  --name onebots \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  onebots

# 查看日志
docker logs -f onebots

# 停止并删除容器
docker stop onebots && docker rm onebots
```

## 使用 GitHub 构建的镜像

若仓库已配置 [GitHub Actions 构建 Docker 镜像](https://github.com/lc-cn/onebots/actions)，可直接拉取 GHCR 镜像，无需本地构建：

```bash
# 拉取最新镜像
docker pull ghcr.io/lc-cn/onebots:master

# 运行
docker run -d \
  --name onebots \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  ghcr.io/lc-cn/onebots:master
```

发布 Release 后会有带版本号的标签，例如：`ghcr.io/lc-cn/onebots:1.0.0`。

## 数据与配置

| 路径（容器内） | 说明 |
|----------------|------|
| `/data/config.yaml` | 主配置文件，**必须**通过卷挂载以便持久化与修改 |
| `/data/data/` | 数据库与审计日志等，由应用自动创建 |

建议将宿主机目录挂载到容器的 `/data`，例如 `-v $(pwd)/data:/data`，这样：

- 配置文件修改后重启容器即可生效
- 数据库、日志等不会随容器删除而丢失

## 自定义适配器与协议

镜像内已默认注册常用适配器与协议。若只需部分平台，可覆盖默认启动参数：

```bash
docker run -d \
  --name onebots \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  onebots \
  -c /data/config.yaml -r qq -r wechat -p onebot-v11 -p onebot-v12
```

参数含义与命令行一致：`-r` 指定适配器（可多次），`-p` 指定协议（可多次），`-c` 指定配置文件。

## 端口与网络

- 默认网关端口为 **6727**（可在 `config.yaml` 中修改 `port`）。
- 使用 `docker run` 时需保证 `-p` 与配置中的端口一致，例如配置改为 `port: 8080` 则使用 `-p 8080:8080`。

## 部署到 Hugging Face Spaces

仓库内提供了面向 [Hugging Face Spaces](https://huggingface.co/docs/hub/spaces-sdks-docker) 的 Docker 配置，使用端口 **7860**（HF 默认），无需在 HF 上从源码构建。

**使用步骤：**

1. 在 Hugging Face 创建 Space，SDK 选择 **Docker**。
2. 在 Space 仓库中放入以下两个文件（可从本仓库复制）：
   - **Dockerfile**：复制自仓库的 `Dockerfile.hf`（或把 `Dockerfile.hf` 重命名为 `Dockerfile`）。
   - **docker-entrypoint-hf.sh**：与 `Dockerfile.hf` 同目录的入口脚本。
3. 如需持久化配置，在 Space 的 **Storage** 中挂载卷到 `/data`，并在其中放置或生成 `config.yaml`。

`Dockerfile.hf` 基于官方镜像 `ghcr.io/lc-cn/onebots:master`，仅增加 HF 的端口与入口脚本，构建快且不需要 GitHub Packages 的 build secret。

本地测试 HF 镜像（映射 7860）：

```bash
docker build -f Dockerfile.hf -t onebots-hf .
docker run -p 7860:7860 -v $(pwd)/data:/data onebots-hf
```

## 生产环境建议

- 使用 **docker compose** 或编排系统（如 Kubernetes）管理容器，并设置 `restart: unless-stopped` 或等效重启策略。
- 为 `/data` 卷做定期备份（包含 `config.yaml` 与 `data/` 目录）。
- 若需对外暴露，建议前接反向代理（如 Nginx、Caddy）并配置 HTTPS。
- 健康检查可调用容器内 `http://localhost:6727/health` 与 `/ready`，参见 [生产就绪功能](/guide/production)。

## 相关文档

- [快速开始](/guide/start) — 非 Docker 的安装与启动
- [全局配置](/config/global) — 配置文件说明
- [生产就绪功能](/guide/production) — 安全、监控与健康检查
