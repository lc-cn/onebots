# Docker 部署

通过 Docker 可以快速部署 onebots 网关，无需在宿主机安装 Node.js。镜像基于 Node 24 Alpine，体积较小。

## 前置要求

- 已安装 [Docker](https://docs.docker.com/get-docker/)（及可选 [Docker Compose](https://docs.docker.com/compose/install/)）

## 快速开始

### 方式一：使用 Docker Compose（推荐）

在项目目录下创建 `docker-compose.yml`，推荐直接使用官方镜像（无需本地构建）。**务必挂载 `./data` 到容器的 `/data`**，否则用户配置（config.yaml）与数据不会持久化，重启容器后会丢失。

```yaml
# OneBots 网关 - Docker Compose（使用官方镜像）
# 使用：docker compose up -d
# 必须挂载 ./data 以持久化用户 config.yaml 与数据

services:
  onebots:
    image: ghcr.io/lc-cn/onebots:master
    container_name: onebots
    restart: unless-stopped
    ports:
      - "6727:6727"
    volumes:
      # 持久化用户配置 config.yaml 与数据（SQLite、日志等）
      - ./data:/data
    environment:
      - NODE_ENV=production
```

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
# 使用官方镜像并运行（务必 -v 挂载以持久化用户 config）
docker run -d \
  --name onebots \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  ghcr.io/lc-cn/onebots:master

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
| `/data/config.yaml` | 用户主配置文件，**必须**通过卷挂载以持久化，否则重启容器后丢失 |
| `/data/data/` | 数据库与审计日志等，由应用自动创建 |

**务必**将宿主机目录挂载到容器的 `/data`（如 `-v $(pwd)/data:/data` 或 docker-compose 中的 `./data:/data`），这样：

- 用户配置 `config.yaml` 持久化在宿主机，重启或重建容器后仍生效
- 数据库、日志等不会随容器删除而丢失

入口脚本会在未显式传入 `-c`/`--config` 时自动使用 `/data/config.yaml`，避免配置落到容器内 `/app/development` 导致重建后丢失。

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
3. 如需持久化配置与数据，见下方「HF 上持久化并查看 /data」。

`Dockerfile.hf` 基于官方镜像 `ghcr.io/lc-cn/onebots:master`，仅增加 HF 的端口与入口脚本，构建快且不需要 GitHub Packages 的 build secret。

### HF 上挂载并查看持久化的 /data

- **挂载**：Hugging Face 的持久化存储由平台在**运行时**自动挂载，路径固定为 **`/data`**（与 OneBots 使用的目录一致）。  
  1. 打开你的 Space → **Settings** → **Storage**（或 Billing / 存储相关设置）。  
  2. 若提供 **Persistent storage** 升级项，开通后 HF 会把持久化卷挂载到容器的 `/data`，无需在 Dockerfile 里写 `VOLUME` 或挂载命令。  
  3. 若当前账号/区域未提供持久化存储，重启或重建 Space 后 `/data` 内的内容会丢失；可将重要配置备份到 [Dataset](https://huggingface.co/docs/hub/spaces-storage#dataset-storage) 或外部存储。

- **查看**：HF 不提供“在网页上浏览容器内 `/data` 文件”的功能；Space 的 **Files** 页只显示仓库（Dockerfile、脚本等），不显示运行时卷里的内容。  
  - 若需查看或备份：可通过 OneBots 自带的 Web 管理端（若有）查看配置与状态，或自行在应用里加只读 API（如列出 `/data` 下的文件、下载 `config.yaml`）。  
  - 首次运行且未挂载持久化卷时，入口脚本会在 `/data` 下生成默认 `config.yaml`，仅当启用持久化后该文件才会在重启后保留。

### HF 免付费：用 Space 仓库备份整个 data 目录

未购买持久化存储时，每次重启或重建 Space 会清空 `/data`。可用 **Space 的 Git 仓库** 备份**整个 data 目录**（配置、数据库、日志等），仓库里的文件会保留。

1. **设置变量**（Space → Settings → Variables）  
   - **`HF_REPO_ID`**：你的 Space 仓库 ID，格式 `用户名/Space 名称`（例如 `liangcai/onebots`）。入口脚本在启动时若发现 `/data` 为空或缺少 `config.yaml`，会按顺序尝试：  
     - 下载 **`data_backup.tar.gz`**（整个 data 的压缩包），解压到 `/data`，实现完整恢复；  
     - 若无该文件，再下载 **`config_backup.yaml`** 仅恢复配置。

2. **自动备份（推荐）**  
   - 在 Space → Settings → **Secrets** 中新增 **`HF_TOKEN`**（需有写权限的 [Access Token](https://huggingface.co/settings/tokens)）。  
   - 在 **Variables** 中设置 **`HF_REPO_ID`**（同上）。  
   - 之后在 Web 端「配置管理」里点击「保存配置」时，会将**整个 `/data` 目录**打成 `data_backup.tar.gz`，并与当前配置一起提交到该 Space 仓库（`config_backup.yaml` + `data_backup.tar.gz`）。下次重启时优先用 `data_backup.tar.gz` 完整恢复，无需手动操作。  
   - 若 data 目录过大（例如 >15MB），可能只会上传 `config_backup.yaml`，可定期在 Web 端保存以更新备份。

3. **仅手动备份**  
   - 不设置 `HF_TOKEN`，只设置 **`HF_REPO_ID`**。  
   - 在 Web 端改好配置后点击「下载当前配置」，在 Space 的 **Files** 里上传为 **`config_backup.yaml`**；若有本地 data 目录压缩包，可上传为 **`data_backup.tar.gz`**（解压后内容应为 config.yaml、data/ 等，与 `/data` 结构一致）。  
   - 下次重启时脚本会优先用 `data_backup.tar.gz` 恢复整个 data，否则用 `config_backup.yaml` 恢复配置。

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
