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
      # 与 restart 策略成对声明，允许 Web 安全触发实例切换
      - ONEBOTS_RESTARTABLE=1
      # 可选：从同目录 .env 注入，适合无法直接读取 /data/config.yaml 的部署
      - ONEBOTS_ACCESS_TOKEN=${ONEBOTS_ACCESS_TOKEN:-}
    healthcheck:
      test: ["CMD", "node", "/app/scripts/docker-healthcheck.mjs"]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3
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

首次运行会在当前目录下创建 `./data`，并在其中生成权限为 `0600` 的默认 `config.yaml`；入口脚本从第一次持久化写入起使用私有 `umask`，无法收紧配置权限时会拒绝启动。默认文件不包含平台账号，因此不会用空凭据连接外部平台；若没有环境鉴权或文件凭据，容器会把随机 256 位 `access_token` 写入该配置，但不会把鉴权码输出到容器日志。从 `./data/config.yaml` 读取鉴权码登录 Web 管理端。若部署环境不能直接读取挂载文件，可把高熵鉴权码作为 Secret 注入 `ONEBOTS_ACCESS_TOKEN`；它优先于文件 token，且不会被写入配置或日志。添加账号、设置协议访问令牌后，“保存并应用”会立即热重载账号与协议。Compose 示例把 `ONEBOTS_RESTARTABLE=1` 与 `restart: unless-stopped` 成对配置，因此 Web 安装扩展后可以安全切换实例；没有可验证监督器的前台进程会保留在线并要求人工重启。扩展中心安装的依赖和清单保存在 `./data/extensions`，容器重启或用新镜像重建后仍会从同一目录加载；入口只刷新镜像内置包的受管链接，不会覆盖用户安装的依赖。只有端口、路径、数据库等宿主参数变更时，页面才会明确提示执行 `docker compose restart`。

仓库提供 `.env.example`。需要环境鉴权时复制为 `.env`，填写由密码管理器或 `openssl rand -hex 32` 生成的值，再执行 `docker compose up -d`；`.env` 已被 Git 忽略。修改后必须重启容器。

### 容器运行用户与卷权限

官方镜像只在入口初始化阶段使用 `root` 创建或迁移 `/data`。配置权限收紧后，入口会把挂载卷交给镜像内置的 `node` 用户（uid/gid `1000`），再通过 `su-exec` 启动网关；平台适配器、协议和 Web 管理进程不会长期以 root 身份运行。入口同时把 `HOME`、`USER` 和 `LOGNAME` 切换到该账号，镜像内的 Corepack 使用预先准备且可写的共享缓存，因此 Web 扩展安装不会继续访问 `/root` 而触发权限错误。升级旧镜像后的第一次启动会递归调整现有 `/data` 的属主，因此宿主机上看到的文件属主可能变为 `1000:1000`。

若卷后端禁止修改属主，入口会明确报错并停止，避免以 root 身份静默降级运行。也可以用 Docker 的 `--user` 或 Compose 的 `user:` 显式指定运行身份；此时入口尊重该身份且不会执行 `chown`，但调用方必须预先保证该用户能读取 `/data/config.yaml` 并写入 `/data`。

默认扩展根为 `/data/extensions`。只有在额外挂载了其他持久化目录时才需要设置 `ONEBOTS_EXTENSION_ROOT`，且容器内路径必须使用绝对路径，避免启动目录变化后安装与加载落到不同位置。

### 容器健康状态

官方镜像内置健康检查，Compose 示例也显式启用同一探针。探针读取 `/data/config.yaml` 的 `port` 与 `path`，请求对应的 `/ready`，并要求 HTTP 成功、`application/json` 媒体类型、响应明确包含 `ready: true`，且声明 `onebots` 应用身份、与镜像内主包完全一致的运行版本及非空 `instance_id`。探针禁用缓存与重定向，并把响应正文限制为 64 KiB；旧 OneBots 实例、错误代理、通用成功页或持续发送数据的本地进程不能充当容器就绪证据。可用以下命令查看状态与最近失败原因：

```bash
docker compose ps
docker inspect --format '{{json .State.Health}}' onebots
```

只要任一已配置账号离线、协议出口未就绪，或磁盘配置与当前运行版本不同步，容器就会显示 `unhealthy`，便于负载均衡器和编排系统停止转发流量。宿主字段保存后出现该状态时，应完成页面要求的容器重启；意外漂移则应先核对挂载文件。Docker/Compose 的 `restart` 策略不会仅因 `unhealthy` 自动重启容器，仍应结合外部监控或编排策略处理持续故障。

默认配置路径以外的部署可设置 `ONEBOTS_CONFIG_PATH`；`PORT` 和 `ONEBOTS_PATH` 会覆盖配置中的端口与路径。也可用 `ONEBOTS_HEALTHCHECK_URL` 直接指定完整就绪地址。Hugging Face 镜像继承此探针，并自动使用其 `PORT=7860`。

### 方式二：使用 docker run

```bash
# 使用官方镜像并运行（务必 -v 挂载以持久化用户 config）
docker run -d \
  --name onebots \
  --restart unless-stopped \
  -e ONEBOTS_RESTARTABLE=1 \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  ghcr.io/lc-cn/onebots:master

# 查看日志
docker logs -f onebots

# 停止并删除容器
docker stop onebots && docker rm onebots
```

### 方式三：1Panel

仓库内提供与 [1Panel 应用商店](https://github.com/1Panel-dev/appstore) 相同布局的应用描述（`data.yml`、`docker-compose.yml`、表单端口等），便于在面板中一键编排或向官方应用库投稿。说明见 **[deploy/1panel](../../../deploy/1panel/README.md)**。

## 使用 GitHub 构建的镜像

若仓库已配置 [GitHub Actions 构建 Docker 镜像](https://github.com/lc-cn/onebots/actions)，可直接拉取 GHCR 镜像，无需本地构建：

```bash
# 拉取最新镜像
docker pull ghcr.io/lc-cn/onebots:master

# 运行
docker run -d \
  --name onebots \
  --restart unless-stopped \
  -e ONEBOTS_RESTARTABLE=1 \
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
| `/data/extensions/` | Web 扩展中心的依赖清单与已安装包；入口从这里启动并保留用户依赖 |

**务必**将宿主机目录挂载到容器的 `/data`（如 `-v $(pwd)/data:/data` 或 docker-compose 中的 `./data:/data`），这样：

- 用户配置 `config.yaml` 持久化在宿主机，重启或重建容器后仍生效
- 数据库、日志等不会随容器删除而丢失
- 扩展中心安装的适配器与协议不会只留在容器可写层中

入口脚本会在未显式传入 `-c`/`--config` 时自动使用 `/data/config.yaml`，避免配置落到容器内 `/app/development` 导致重建后丢失。

## 自定义适配器与协议

镜像内已默认注册常用适配器与协议。若只需部分平台，可覆盖默认启动参数：

```bash
docker run -d \
  --name onebots \
  --restart unless-stopped \
  -e ONEBOTS_RESTARTABLE=1 \
  -p 6727:6727 \
  -v $(pwd)/data:/data \
  onebots \
  -c /data/config.yaml -r qq -r wechat -p onebot-v11 -p onebot-v12
```

参数含义与命令行一致：`-r` 指定适配器（可多次），`-p` 指定协议（可多次），`-c` 指定配置文件。

### 官方镜像与 ICQQ（非官方 QQ 协议）

**GHCR 官方 Docker 镜像不包含** `adapter-icqq` 及其依赖 `@icqqjs/icqq`：仓库根目录 `.dockerignore` 会排除 `adapters/adapter-icqq`，构建阶段也不再使用 GitHub Packages 的 build secret。因此镜像内**没有** ICQQ 适配器，默认启动参数里**也不会**带 `-r icqq`。

若你确需在容器中使用 ICQQ，请**自行在本地用完整源码构建镜像**（勿排除上述目录），并自行配置能拉取 `@icqqjs/icqq` 的 npm 凭据与合规评估。一般场景请使用 **QQ 官方开放平台**适配器（`-r qq`）。

## 端口与网络

- 默认网关端口为 **6727**（可在 `config.yaml` 中修改 `port`）。
- 使用 `docker run` 时需保证 `-p` 与配置中的端口一致，例如配置改为 `port: 8080` 则使用 `-p 8080:8080`。

## 部署到 Hugging Face Spaces

仓库内提供了面向 [Hugging Face Spaces](https://huggingface.co/docs/hub/spaces-sdks-docker) 的 Docker 配置，使用端口 **7860**（HF 默认），无需在 HF 上从源码构建。

**使用步骤：**

1. 在 Hugging Face 创建 Space，SDK 选择 **Docker**。
2. 在 Space 仓库中放入以下三个文件（可从本仓库复制，并保留 `scripts/` 子目录）：
   - **Dockerfile**：复制自仓库的 `Dockerfile.hf`（或把 `Dockerfile.hf` 重命名为 `Dockerfile`）。
   - **docker-entrypoint-hf.sh**：与 `Dockerfile.hf` 同目录的入口脚本。
   - **scripts/hf-repository-download.mjs**：有界恢复下载器，路径需与 `Dockerfile` 中的 `COPY` 保持一致。
3. 在 Space → **Settings** → **Secrets** 中新增 `ONEBOTS_ACCESS_TOKEN`，值使用密码管理器或 `openssl rand -hex 32` 生成。部署完成后用该值登录管理端；不要放在公开的 Variables 中。
4. 如需持久化配置与数据，见下方「HF 上持久化并查看 /data」。

`Dockerfile.hf` 基于官方镜像 `ghcr.io/lc-cn/onebots:master`，仅增加 HF 的端口、入口脚本与无外部依赖的恢复下载器，构建快且不需要 GitHub Packages 的 build secret。

`ONEBOTS_ACCESS_TOKEN` 是部署级覆盖项，即使恢复的 `config.yaml` 已含旧 `access_token`，管理端仍使用 Secret 中的值。修改 Secret 后需要重启 Space。启动日志只会说明环境鉴权已启用，不会输出鉴权码。HF 入口会把下载、解压与新建文件置于私有 `umask` 下，并在启动前把恢复后的 `/data/config.yaml` 验证为 `0600`；不能提供私有文件权限的存储不会被误报为安全启动。

### HF 上挂载并查看持久化的 /data

- **挂载**：Hugging Face 的持久化存储由平台在**运行时**自动挂载，路径固定为 **`/data`**（与 OneBots 使用的目录一致）。  
  1. 打开你的 Space → **Settings** → **Storage**（或 Billing / 存储相关设置）。  
  2. 若提供 **Persistent storage** 升级项，开通后 HF 会把持久化卷挂载到容器的 `/data`，无需在 Dockerfile 里写 `VOLUME` 或挂载命令。  
  3. 若当前账号/区域未提供持久化存储，重启或重建 Space 后 `/data` 内的内容会丢失；可将重要配置备份到 [Dataset](https://huggingface.co/docs/hub/spaces-storage#dataset-storage) 或外部存储。

- **查看**：HF 不提供“在网页上浏览容器内 `/data` 文件”的功能；Space 的 **Files** 页只显示仓库（Dockerfile、脚本等），不显示运行时卷里的内容。  
  - 使用 `ONEBOTS_ACCESS_TOKEN` 登录后，可在 OneBots 的「配置管理」页面查看或下载当前配置。
  - 首次运行且未挂载持久化卷时，入口脚本会在 `/data` 下生成默认 `config.yaml`，仅当启用持久化后该文件才会在重启后保留。

### HF 免付费：用 Space 仓库备份配置、扩展与数据

未购买持久化存储时，每次重启或重建 Space 会清空 `/data`。可用 **Space 的 Git 仓库** 保存配置、受信任扩展恢复清单和有界数据归档。

1. **设置变量**（Space → Settings → Variables）  
   - **`HF_REPO_ID`**：你的 Space 仓库 ID，格式 `用户名/Space 名称`（例如 `liangcai/onebots`）。入口脚本在启动时若发现 `/data` 为空或缺少 `config.yaml`，会按顺序尝试：  
     - 下载非空的 **`data_backup.tar.gz`** 并解压到 `/data`；归档不包含可重新安装的 `extensions/node_modules`、扩展清单和锁文件；
     - 下载 **`config_backup.yaml`** 恢复配置；
     - 新扩展卷同时下载 **`extensions_backup.json`**，只接受当前镜像扩展目录中的包，并按当前固定版本执行 pnpm 恢复。未知或已从当前目录移除的包会在安装前拒绝。

2. **自动备份（推荐）**  
   - 在 Space → Settings → **Secrets** 中新增 **`HF_TOKEN`**（需有写权限的 [Access Token](https://huggingface.co/settings/tokens)）。  
   - 在 **Variables** 中设置 **`HF_REPO_ID`**（同上）。  
   - 之后在 Web 端「配置管理」里点击「保存配置」时，会提交 `config_backup.yaml`、`extensions_backup.json` 与不超过 15 MiB 的 `data_backup.tar.gz`。扩展恢复清单只记录扩展目录中已安装、受当前 OneBots 版本信任的包，并固定为发布目录版本。
   - 若数据归档超过限制或 tar 失败，备份仍会成功提交配置与扩展恢复清单，并用空文件覆盖远端旧归档，避免下次启动误恢复过期数据。管理端会明确说明本次是否包含完整数据归档。
   - tar 最多运行 30 秒，HF 提交最多等待 60 秒；上游失败正文最多读取 64 KiB。磁盘异常、半开连接或代理返回异常大响应时，配置保存和静态文件操作会在明确边界内返回备份失败诊断，不会无限等待。
   - 容器启动恢复同样最多等待每个制品 60 秒；压缩归档上限为 15 MiB，配置与扩展清单各为 1 MiB。下载内容先写入权限 `0600` 的同目录临时文件，完整且未超限后才原子替换目标；断流、超限或目标父目录是符号链接时保留已有持久化文件并继续使用安全回退，不会把半份配置当作可启动状态。临时数据归档会在下载前与解压后清理，进程重启不会因新下载失败而重复恢复旧归档。

3. **仅手动备份**  
   - 不设置 `HF_TOKEN`，只设置 **`HF_REPO_ID`**。  
   - 在 Web 端改好配置后点击「下载当前配置」，在 Space 的 **Files** 里上传为 **`config_backup.yaml`**；若有本地 data 目录压缩包，可上传为 **`data_backup.tar.gz`**。
   - 手动安装的非目录扩展不会进入自动恢复白名单；需要这类扩展时应使用 HF Persistent Storage 或自行维护可信镜像与恢复流程。

本地测试 HF 镜像（映射 7860）：

**Telegram / Discord 等外部 API**：HF 上容器内 DNS 有时无法解析 `api.telegram.org`、`discord.com` 等，会报 `ENOTFOUND`。入口脚本已尝试在启动时将 DNS 设为 8.8.8.8 / 1.1.1.1；若仍报 ENOTFOUND，可能是 HF 将 `/etc/resolv.conf` 只读挂载或限制出网，可到 [HF 论坛](https://discuss.huggingface.co/c/spaces/11) 反馈或改用自建/其它托管。

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
