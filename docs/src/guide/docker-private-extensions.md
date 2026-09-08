# Docker 私有扩展安装

官方镜像不包含 ICQQ 及 `@icqqjs/icqq`。私有扩展由你使用自己的包访问授权安装，不需要把 Token 交给长期运行的网关，也不需要向容器挂载 Docker socket。

## 一次性安装器

在 **Docker 宿主机** 的 Compose 项目目录运行。需要本机 Docker CLI、POSIX shell，以及当前版本的官方镜像；Windows 可在 WSL 中执行。默认使用当前目录的 `data` 绑定目录、`ghcr.io/lc-cn/onebots:master` 镜像和名为 `onebots` 的容器。

下载与当前镜像版本匹配的仓库脚本，或在对应仓库 checkout 中运行：

```bash
sh scripts/docker-extensions.sh install icqq --apply
```

交互终端会隐藏输入 GitHub Packages Token。Token 需要 `read:packages` 和 `@icqqjs` 包访问资格；它只用于下载，不是 QQ 登录密码。脚本不会自动启用账号或协议。

`--apply` 会检查目标容器的镜像与数据目录，安装成功后重启容器，并检查实际扩展运行目录及 readiness。失败则恢复上一扩展版本、重新启动并检查旧版本。旧版本也无法恢复在线时会明确报错，不宣告恢复成功。它不会修改你的账号配置。

不传 `--apply` 时，只选择经过验证的下次启动版本，不重启在线容器：

```bash
sh scripts/docker-extensions.sh install icqq
# 合适的维护窗口再执行：
docker compose restart onebots
```

安装其他平台用短名，协议用完整官方包名：

```bash
sh scripts/docker-extensions.sh install telegram @onebots/protocol-onebot-v11
```

仅允许当前镜像版本目录中的扩展；包版本由镜像目录指定。已有私有扩展会保留在新候选版本中，并与当前镜像的版本目录对齐，因此再次安装或升级时可能仍需提供其下载凭据。

可通过环境变量指定部署位置，不能通过命令参数传 Token：

```bash
ONEBOTS_IMAGE=ghcr.io/lc-cn/onebots:master \
ONEBOTS_DATA_DIR=/srv/onebots/data \
ONEBOTS_CONTAINER_NAME=onebots \
sh scripts/docker-extensions.sh install icqq --apply
```

脚本固定本次操作的本地镜像 ID。若镜像尚未存在，会先拉取；已有镜像不会静默更新。需要升级镜像时请主动拉取，并使用相同镜像准备候选扩展与创建容器。镜像版本、Node 版本或架构变化导致已有候选不兼容时，启动会拒绝使用该候选，不会偷偷联网重装。

## 自动化凭据

准备一个位于构建上下文之外、权限受限的 npmrc 文件：

```ini
@icqqjs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=填写你自己的只读Token
```

```bash
chmod 600 /secure/onebots-install.npmrc
ONEBOTS_NPMRC_FILE=/secure/onebots-install.npmrc \
sh scripts/docker-extensions.sh install icqq --apply
```

文件仅只读挂载到下载容器的 `/run/secrets/npmrc`；不会挂载到验证容器和网关。支持其他 registry 的域名限定 Token，同一个文件可以配置多个 scope。外部 registry 必须使用 HTTPS；URL 不能夹带用户名、密码或查询凭据。npmrc 不接受脚本、pnpmfile 等执行配置，也不会继承宿主机全局 npm 配置。

下载结束后会删除容器内临时认证副本；交互输入产生的宿主临时文件也会删除。你提供的 npmrc 源文件由你负责保管、删除或轮换。Docker 管理员和宿主机管理员仍能访问安装期间的凭据；此机制不能防御被控制的宿主机。

## 隔离和持久化

流程依次是：

1. 获取安装锁，创建独立候选目录；在线版本保持不变。
2. 下载容器临时读取认证，随后以 `node` 用户运行 pnpm；禁用安装脚本和 pnpmfile 钩子。
3. 验证容器以 `node` 用户运行，只挂载候选目录，不挂载认证或其他版本目录，且 `--network none`。
4. 检查扩展版本、入口和注册结果，记录锁文件摘要与镜像兼容信息。
5. 原子切换版本指针；按需由宿主 Docker 重启并验证。

配置、数据库仍在 `data` 中。新扩展保存在 `data/extensions/releases/<版本ID>`，选择记录为 `data/extensions/active-release.json`。重启不会重新下载；Token 失效不会妨碍已经安装好的模块运行。不要把旧的 `node_modules` 从其他系统或架构直接复制过来。

普通 Docker 工作台只选择**已经安装**的扩展，并编辑配置；运行页提供宿主 Docker 操作步骤。Web 和 CLI 不会就地安装、更新或卸载隔离模式的在线依赖；仍可按原有流程停用账号出口。HF 的旧扩展恢复机制保持独立，不适用此宿主协调器。

## 需要构建脚本的依赖

默认不执行任何第三方安装脚本。如果某个依赖确实需要构建，必须明确指定允许的包名：

```bash
ONEBOTS_ALLOW_BUILD='需要构建的包名' \
sh scripts/docker-extensions.sh install icqq
```

这些脚本只在无凭据、无网络的验证容器中执行。需要联网的 postinstall、缺少编译工具或不兼容 Alpine 的依赖会失败；应准备具备所需工具的同一基础镜像，不能通过给验证容器补回 Token 来绕过。允许构建的包仍是你信任的代码，扩展实际运行时也拥有网关进程的配置和数据访问能力。

## 回滚与故障排查

安装成功时会输出版本 ID：

```bash
sh scripts/docker-extensions.sh rollback 当前版本ID --apply
```

只能回滚当前版本，防止覆盖其他操作的切换。首次隔离安装也可以回退到原有 `/data/extensions` 布局。旧版本目录不会自动删除；确认不再用于回滚、且没有进程使用后再清理。回滚扩展不会回滚账号配置或数据库。

- **401/403**：检查 registry、Token 权限和包访问资格；原始包管理器输出不会直接打印，以免包含认证信息。
- **安装锁已存在**：先确认没有安装容器仍在运行。正常退出会释放锁；宿主强制断电或进程被杀死后可能保留锁，不会按超时自动抢占。确认所有相关容器已停止后，再由管理员处理 `data/extensions/.release-install.lock`。
- **候选验证失败**：当前版本保持不变。检查镜像目录版本和 SDK 要求；不要手工把 `downloaded` 改为 `verified`。
- **重启失败**：查看 `docker logs onebots`。使用了自定义配置、数据目录、容器名称或镜像时先核对是否指向同一部署。
- **目录权限错误**：安装目录和运行目录最终归容器 `node` 用户（UID/GID 1000）。宿主用户必须有权管理所选 data 目录；不要用全局 `chmod 777` 修复。

## 私有派生镜像

需要固定、不依赖运行时下载安装的部署，可以使用仓库中的 `deploy/docker/Dockerfile.private`：

```bash
docker build -f deploy/docker/Dockerfile.private \
  --build-arg ONEBOTS_BASE=ghcr.io/lc-cn/onebots:master \
  --secret id=npmrc,src=/secure/onebots-install.npmrc \
  -t your-private-registry/onebots:icqq .
```

示例通过 BuildKit secret 和 tmpfs 下载，随后在不联网、不挂载凭据的独立步骤验证。安装产物位于 `/opt/onebots-private`，不会被 `/data` 挂载覆盖。此方式通过重新构建、替换镜像升级，不使用宿主脚本切换 `/data/extensions`。

**派生镜像和构建缓存包含私有模块代码，必须限制访问，不能发布到公共镜像仓库。** Secret mount 保护凭据，不授予私有包的再分发权限。不要改成 `ARG TOKEN`、`ENV TOKEN`，也不要 `COPY .npmrc` 后再删除。
