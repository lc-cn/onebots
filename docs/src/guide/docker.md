# Docker 部署

通过 Docker 可以快速部署 onebots 网关，无需在宿主机安装 Node.js。镜像基于 Node 24 Alpine，体积较小。

## 前置要求

- 已安装 [Docker](https://docs.docker.com/get-docker/)（及可选 [Docker Compose](https://docs.docker.com/compose/install/)）

## 快速开始

### 方式一：使用 Docker Compose（推荐）

在项目根目录创建 `docker-compose.yml`（若仓库中已有可跳过），然后执行：

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
# 拉取最新镜像（将 <owner>/<repo> 替换为你的仓库，如 lc-cn/onebots）
docker pull ghcr.io/<owner>/<repo>:master

# 运行
docker run -d \
  --name onebots \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  ghcr.io/<owner>/<repo>:master
```

发布 Release 后会有带版本号的标签，例如：`ghcr.io/<owner>/<repo>:1.0.0`。

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

## 生产环境建议

- 使用 **docker compose** 或编排系统（如 Kubernetes）管理容器，并设置 `restart: unless-stopped` 或等效重启策略。
- 为 `/data` 卷做定期备份（包含 `config.yaml` 与 `data/` 目录）。
- 若需对外暴露，建议前接反向代理（如 Nginx、Caddy）并配置 HTTPS。
- 健康检查可调用容器内 `http://localhost:6727/health` 与 `/ready`，参见 [生产就绪功能](/guide/production)。

## 相关文档

- [快速开始](/guide/start) — 非 Docker 的安装与启动
- [全局配置](/config/global) — 配置文件说明
- [生产就绪功能](/guide/production) — 安全、监控与健康检查
