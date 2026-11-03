# Docker 部署

Docker 只托管常驻管理服务，管理服务负责独立网关的启停。空卷直接提供 Web，不预填平台账号或协议。

> 镜像、入口脚本和 CLI 必须来自同一版本。旧镜像不支持本文的管理服务流程；升级时保留整个 `/data`，不要混用旧启动参数。

## 启动与首次配对

先构建并启动本分支镜像：

```bash
docker build -t onebots-control .
docker run -d --name onebots --restart unless-stopped \
  -p 6727:6727 -v "$(pwd)/data:/data" \
  -v onebots-authority:/var/lib/onebots-authority onebots-control
```

首次启动只提供来源诊断，尚不能配对。先停止服务，通过挂载相同两个卷的离线容器执行 [工作区计划与显式登记](/guide/workspace-admission)，再正常启动。登记完成后访问 `http://localhost:6727`，在宿主终端签发一次性配对码：

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

必须挂载整个 `/data`，并独立持久挂载 `/var/lib/onebots-authority`。后者不能与数据备份一起复制。数据卷在重建后保留：

| 路径 | 内容 |
| --- | --- |
| `/data/config.yaml` | 用户配置，不预填账号或协议 |
| `/data/data/` | 账号数据、数据库和业务日志 |
| `/data/.control/` | 管理会话、操作、配置草稿及不可变依赖版本 |

同机持久化需要保留 `.control`。同一持久卷正常执行 `docker compose down` 后再 `docker compose up -d`，无需固定 `hostname`：只有管理服务完成正常关闭、写入 `closed` 所有权记录，且网关已停止、没有未决实例、worker 检查通过时，新容器才能接管。原有网关运行/停止意图、配置和管理认证会保留。

强制终止、宿主掉电或关闭未完成可能留下 `active` 记录；若同时发生 hostname 改变，服务保留诊断，不会把无法确认的历史进程当作已退出。先运行 `docker exec --user 1000:1000 onebots node /app/packages/onebots/lib/bin.js doctor --data-dir /data --authority-dir /var/lib/onebots-authority/authority --json --strict` 并保留现场，勿删除或手改 `.control/process-ownership.json` 来绕过检查。

上述正常重建不等同于向另一主机迁移备份。**不支持复制 `.control` 跨主机**，即使其中记录为 `closed`：严格版核验独立 authority 登记与目录物理身份，普通数据卷副本不能自行运行；复制 authority 或整机克隆不在证明范围。

手动转移业务配置前，目标必须先作为独立新安装完成空工作区登记，再通过管理端配置、安装和验证扩展；已有业务数据不能放进未登记目录后当作 fresh 首登。必须先核实源实例及其受管进程已停止，不拷贝 `.control`、authority 或旧 `/data/extensions` 作为目标运行版本。这里不承诺完整归档导入、自动接管或全局 fencing；旧 control v1 升级与更早 legacy 的兼容阶段见[工作区登记与离线升级](/guide/workspace-admission)。

若旧 hostname 的下载或配置验证 worker 记录仍残留，即使顶层记录为 `closed`，现有归属检查仍会拒绝接管；不能在新容器中用同号 PID 证明旧 worker 已退出。请保留这些记录并人工核实，不通过删除记录或跳过 hostname 校验来强行恢复。

入口只会把**真正为空的** `/data` 挂载目录本身交给 `node` 用户（uid/gid 1000），随后降权运行；包含隐藏文件也算已有内容。已有卷不递归 `chown` 或 `chmod`，来源拒绝时保留认证和业务现场。运行用户无法访问时应先停止服务，离线核对原有卷的所有者和权限，入口不会自动修复或清理。指定 `--user` 时也须预先准备相应权限。HF 独立归档工具不会由入口自动执行，也不提供事后递归修复属主。不要通过开放管理目录给所有用户来绕过权限错误。

## 健康、端口与排查

`/healthz` 与 `/ready` 检查管理服务；网关离线不会自动意味着容器不健康。网关状态在 Web 或 `onebots control status` 中查看。镜像探针验证应用名、版本及实例身份，不读取业务 YAML。

```bash
docker logs --tail 100 onebots
docker inspect --format '{{json .State.Health}}' onebots
docker exec --user 1000:1000 onebots \
  node /app/packages/onebots/lib/bin.js doctor --data-dir /data \
  --authority-dir /var/lib/onebots-authority/authority
```

管理监听默认 `6727`，使用 `PORT` 环境变量修改并同步端口映射；覆盖 `--port` 时也须让 `PORT` 与其一致。业务配置中的端口不决定管理服务监听。

Docker 的 restart 策略托管管理进程，网关生命周期由管理服务维护。不要通过容器重启反复重试状态未知的安装或恢复操作，先检查操作记录和诊断。

## Hugging Face 镜像模板与支持边界

`Dockerfile.hf` 保留端口 **7860**、部署码隔离和受限业务备份恢复工具，但不代表已完成 HF 平台的来源 provider 验收。

HF 的 [Storage Buckets 可挂载一个或多个存储桶到自定义路径](https://huggingface.co/docs/hub/spaces-storage)。这些挂载是否提供稳定目录物理身份、可靠的本地 SQLite 文件锁和持久化屏障，当前尚未验证。**不能把 Bucket 或其 FUSE 挂载、两个目录路径直接当作可靠本地卷使用**；未验收的来源存储不支持启动业务，不自动退回 `/data` 子目录或容器可写层保存 authority。本机 OrbStack 的本地 virtiofs 共享目录属于另一种 provider，其 bind mount 验收不能外推到云端存储桶挂载。

使用该模板的部署必须另行满足与标准镜像相同的两个独立、可靠本地持久卷，完成离线来源计划和显式登记，之后才可启动并使用部署码配对。本仓库的 `verify-hf-container.mjs` 在本机 Docker 的独立 named volumes 上验证入口、配对、重建与拒绝路径；它不是 HF 实机、Bucket/FUSE 或宿主重启验收。

复制模板时须同时保留 `docker-entrypoint-hf.sh`、`docker-workspace.sh`、`docker-authority.sh`、`scripts/hf-repository-download.mjs`、`scripts/hf-data-archive-restore.mjs`，且基础镜像与脚本为同一版本。缺少独立 authority 挂载时入口明确失败。

**首期禁用 `HF_REPO_ID` 自动恢复。** 只要此变量非空，入口就在下载、工作区或 authority 初始化、权限修改之前明确退出；移除此变量后才能继续正常来源登记与启动。受控恢复将另行补齐，不能通过先恢复再登记、忽略 `.control` 或自动绑定绕过来源证明。

独立 `hf-repository-download.mjs` / `hf-data-archive-restore.mjs` 工具仍保留，但工具存在不代表归档可直接首次登记或覆盖一个已登记工作区。归档必须排除 `.control`、authority、依赖与下载授权，不能恢复管理会话或 PID 收据；没有完整受支持的导入流程时，保留备份，不直接覆盖运行卷。不要把明文账号数据上传到公开仓库。已有 `.hf-restore-*` 或下载临时标记仍阻止入口启动，必须保留现场诊断，不自动重试或清理。

## 生产环境建议

- 使用 **docker compose** 或编排系统（如 Kubernetes）管理容器，并设置 `restart: unless-stopped` 或等效重启策略。
- 为 `/data` 卷做定期备份（包含 `config.yaml` 与 `data/` 目录）。
- 若需对外暴露，建议前接反向代理（如 Nginx、Caddy）并配置 HTTPS。
- 管理健康检查使用容器内 `http://localhost:6727/healthz` 与 `/ready`；账号状态在管理界面查看。

## 相关文档

- [快速开始](/guide/start) — 非 Docker 的安装与启动
- [全局配置](/config/global) — 配置文件说明
- [生产就绪功能](/guide/production) — 安全、监控与健康检查
