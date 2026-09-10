# Docker 部署

Docker 只托管常驻管理服务，管理服务负责独立网关的启停。空卷直接提供 Web，不预填平台账号或协议。

> 镜像、入口脚本和 CLI 必须来自同一版本。旧镜像不支持本文的管理服务流程；升级时保留整个 `/data`，不要混用旧启动参数。

## 启动与首次配对

先构建并启动本分支镜像：

```bash
docker build -t onebots-control .
docker run -d --name onebots --restart unless-stopped \
  -p 6727:6727 -v "$(pwd)/data:/data" onebots-control
```

访问 `http://localhost:6727`，在宿主终端签发一次性配对码：

```bash
docker exec --user 1000:1000 onebots \
  node /app/packages/onebots/lib/bin.js auth bootstrap --data-dir /data
```

在五分钟内将输出的码输入配对页。之后使用浏览器会话，无需用户名密码或配置里的管理 `access_token`。浏览器授权丢失时，在同一本机命令中将 `bootstrap` 换成 `recover`；恢复码兑换成功后旧会话才失效。不要将这些码发给他人或写入公开日志。

也可使用仓库的 `docker-compose.yml`，将 `image` 改为刚构建的 `onebots-control` 后执行 `docker compose up -d`。无需 `ONEBOTS_RESTARTABLE`、Docker socket 或宿主重启脚本。`.env.example` 中的部署码默认注释；有本地终端时优先使用上面的配对命令。

## 安装与配置

在 Web 或 `onebots control tui` 中选择平台、输出协议和下游框架。所有入口共用安装计划、必需 peer 依赖、验证与运行版本激活流程。私有依赖的下载授权只用于本次安装，不写进配置，也不要给主服务挂载 `.npmrc`。

安装成功后填写账号和协议参数，再校验并应用配置。停止或重启网关不会关闭 Web；安装失败、账号离线和坏 YAML 均通过管理端处理，不需启动第二套安装器。

ICQQ 及其私有 SDK 不预置于基础镜像；需要时通过统一安装界面提供必要的 GitHub Packages 只读下载授权。真实私有仓库授权和平台登录仍需使用者自行验证，不把公开包验收当作 ICQQ 登录证明。

不要再向容器传 `-c/-r/-p/-t` 或从旧 `/data/extensions` 目录启动。公开前台参数只有管理工作区与监听选项，平台、协议、框架选择保存在配置中。

## 数据与权限

必须挂载整个 `/data`，以便容器重建后保留：

| 路径 | 内容 |
| --- | --- |
| `/data/config.yaml` | 用户配置，不预填账号或协议 |
| `/data/data/` | 账号数据、数据库和业务日志 |
| `/data/.control/` | 管理会话、操作、配置草稿及不可变依赖版本 |

同机持久化需要保留 `.control`；跨容器备份恢复不能复制其中的历史 PID、会话和验证收据。旧 `/data/extensions` 不会作为新运行版本直接加载，应保留原数据并通过管理端重新安装所需扩展。

入口以 root 准备卷并交给 `node` 用户（uid/gid 1000），随后降权运行管理服务。若卷不允许调整属主则明确失败；指定 `--user` 时须提前保证该用户可写 `/data`。不要通过开放管理目录给所有用户来绕过权限错误。

## 健康、端口与排查

`/healthz` 与 `/ready` 检查管理服务；网关离线不会自动意味着容器不健康。网关状态在 Web 或 `onebots control status` 中查看。镜像探针验证应用名、版本及实例身份，不读取业务 YAML。

```bash
docker logs --tail 100 onebots
docker inspect --format '{{json .State.Health}}' onebots
docker exec --user 1000:1000 onebots \
  node /app/packages/onebots/lib/bin.js doctor --data-dir /data
```

管理监听默认 `6727`，使用 `PORT` 环境变量修改并同步端口映射；覆盖 `--port` 时也须让 `PORT` 与其一致。业务配置中的端口不决定管理服务监听。

Docker 的 restart 策略托管管理进程，网关生命周期由管理服务维护。不要通过容器重启反复重试状态未知的安装或恢复操作，先检查操作记录和诊断。

## 部署到 Hugging Face Spaces

仓库内提供了面向 [Hugging Face Spaces](https://huggingface.co/docs/hub/spaces-sdks-docker) 的 Docker 配置，使用端口 **7860**（HF 默认），无需在 HF 上从源码构建。

**使用步骤：**

1. 在 Hugging Face 创建 Space，SDK 选择 **Docker**。
2. 在 Space 仓库中放入以下四个文件（可从本仓库复制，并保留 `scripts/` 子目录）：
   - **Dockerfile**：复制自仓库的 `Dockerfile.hf`（或把 `Dockerfile.hf` 重命名为 `Dockerfile`）。
   - **docker-entrypoint-hf.sh**：与 `Dockerfile.hf` 同目录的入口脚本。
   - **scripts/hf-repository-download.mjs**：有界恢复下载器，路径需与 `Dockerfile` 中的 `COPY` 保持一致。
   - **scripts/hf-data-archive-restore.mjs**：数据归档检查与隔离恢复器，同样保留该相对路径。
3. 在 Space → **Settings** → **Secrets** 中新增 `ONEBOTS_BOOTSTRAP_CODE`。用 `node --input-type=module -e "import { randomBytes } from 'node:crypto'; process.stdout.write(randomBytes(32).toString('base64url'))"` 生成随机码，启动后五分钟内在配对页输入。不要放在公开 Variables 中，配对成功后删除该 Secret。
4. 如需持久化配置与数据，见下方「HF 上持久化并查看 /data」。

`Dockerfile.hf` 基于官方镜像 `ghcr.io/lc-cn/onebots:master`，仅增加 HF 的端口、入口脚本与两个无外部依赖的恢复边界，构建快且不需要 GitHub Packages 的 build secret。

部署码只用于首次配对，持久化时只保存摘要，启动后立即从进程环境删除，不传给网关。相同码重启不会延长有效期；未配对时可以换全新随机码后重启（最多 16 次）。已有会话不会被部署码替换；有终端时使用本机 `onebots auth recover`。无终端时，删除旧 `ONEBOTS_BOOTSTRAP_CODE` Secret，按上面的命令生成全新随机码，作为私有 `ONEBOTS_RECOVERY_CODE` Secret 保存并重启，在五分钟内到配对页输入，成功后删除该 Secret。新码兑换成功才撤销旧会话；同码重启不会重发或续期。恢复码不能用于首次初始化，两种 Secret 不能同时设置，也不能复用旧部署码。有效本地恢复码优先；若此前刚申请过本地恢复码，请使用该码，或等它过期后再换全新部署恢复码。恢复历史最多保存 16 次，超过上限需本机恢复；不要删除认证文件绕过限制。管理端不再接受 `ONEBOTS_ACCESS_TOKEN` 或旧用户名密码。

构建 HF 镜像时应使用包含常驻管理服务的同版本基础镜像；需要固定版本时传入 `--build-arg ONEBOTS_BASE_IMAGE=<镜像标签>`，不能混用旧镜像与新入口。

### HF 上挂载并查看持久化的 /data

- **挂载**：Hugging Face 的持久化存储由平台在**运行时**自动挂载，路径固定为 **`/data`**（与 OneBots 使用的目录一致）。  
  1. 打开你的 Space → **Settings** → **Storage**（或 Billing / 存储相关设置）。  
  2. 若提供 **Persistent storage** 升级项，开通后 HF 会把持久化卷挂载到容器的 `/data`，无需在 Dockerfile 里写 `VOLUME` 或挂载命令。  
  3. 若当前账号/区域未提供持久化存储，重启或重建 Space 后 `/data` 内的内容会丢失；可将重要配置备份到 [Dataset](https://huggingface.co/docs/hub/spaces-storage#dataset-storage) 或外部存储。

- **查看**：HF 不提供“在网页上浏览容器内 `/data` 文件”的功能；Space 的 **Files** 页只显示仓库（Dockerfile、脚本等），不显示运行时卷里的内容。  
  - 完成配对后，可在 OneBots 的配置界面检查和编辑配置。
  - 首次运行且未挂载持久化卷时，管理服务会在 `/data` 下生成不含账号和协议的 `config.yaml`，仅当启用持久化后该文件才会在重启后保留。

### 从已有备份恢复

优先使用持久化卷。新管理服务尚未接入旧版“Web 保存即上传 Space 仓库”的自动备份，不要据此假定数据已经备份，也不要将明文配置或账号数据库上传到公开仓库。

可设置 `HF_REPO_ID`，私有仓库下载使用 Secrets 中只读的 `HF_TOKEN`。入口仅在 `/data` 完全为空时尝试下载 `data_backup.tar.gz`；未取得归档时再尝试 `config_backup.yaml`。已有卷不会被远端快照覆盖；无备份或配置损坏时仍保留管理端供配置修复。

归档可包含 `config.yaml`、`data/` 下的账号数据和数据库、`static/`。必须排除 `.control`、依赖目录、包管理授权、缓存和临时文件；不能恢复旧管理会话、历史 PID 或已验证运行版本收据。扩展恢复后须在管理端重新安装与验证。备份数据库前应停止网关并确认退出，不能把活跃数据库的普通文件复制当作一致备份。

恢复检查路径、链接、条目数量与大小限制，通过后才发布文件。取得归档但校验或恢复失败时直接终止，不用另一份配置掩盖失败。残留 `.hf-restore-*` 会阻止启动：先保留卷检查恢复结果，确认无运行进程后在全新空卷重新恢复，不要反复重启或直接清除标记。

管理监听使用 `PORT`（默认 7860），不会改写业务 YAML。DNS 与出网限制应在部署环境排查，入口不覆盖系统 DNS。

本地测试 HF 镜像（基础镜像须与入口版本一致）：

```bash
docker build -f Dockerfile.hf -t onebots-hf .
docker run -p 7860:7860 -v $(pwd)/data:/data onebots-hf
```

## 生产环境建议

- 使用 **docker compose** 或编排系统（如 Kubernetes）管理容器，并设置 `restart: unless-stopped` 或等效重启策略。
- 为 `/data` 卷做定期备份（包含 `config.yaml` 与 `data/` 目录）。
- 若需对外暴露，建议前接反向代理（如 Nginx、Caddy）并配置 HTTPS。
- 管理健康检查使用容器内 `http://localhost:6727/healthz` 与 `/ready`；账号状态在管理界面查看。

## 相关文档

- [快速开始](/guide/start) — 非 Docker 的安装与启动
- [全局配置](/config/global) — 配置文件说明
- [生产就绪功能](/guide/production) — 安全、监控与健康检查
