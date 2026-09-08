# Docker 私有扩展安装

官方镜像不包含 ICQQ 及 `@icqqjs/icqq`。私有扩展由你使用自己的包访问授权安装，不需要把 Token 交给长期运行的网关，也不需要向容器挂载 Docker socket。

## 推荐：跟着向导完成

在 Docker 宿主机的 OneBots 仓库目录运行：

```bash
sh scripts/docker-extensions.sh
```

选择「安装扩展」后，直接使用 OneBots TUI 的同一套表单：勾选平台、填写必要凭据、选择协议和下游框架，最后统一确认。安装器自动识别当前 Compose 项目的 OneBots 容器、镜像和数据目录，安装并检查所需依赖，成功后重启，失败自动恢复。**不用填写镜像参数、编写 npmrc 或记住版本 ID。** 没有容器时会先准备好依赖，再提示运行 `docker compose up -d`。

想撤销上次安装，再次打开向导，选择「恢复上一版本」即可。安装只准备扩展，不会自动启用账号或协议；依赖验证通过后，同一命令会继续打开 OneBots 工作台配置账号与协议；保存并退出后由宿主应用。

需要本机 Docker CLI 和终端；Windows 可在 WSL 中执行。脚本与镜像应使用同一发布版本。目前支持本地 `data` 绑定目录，其他部署会明确提示，不会猜测或修改别的容器。

::: details 高级用法、自动化与故障排查

## 快捷命令与高级选项

熟悉操作后可以跳过向导：

```bash
sh scripts/docker-extensions.sh install icqq --apply
sh scripts/docker-extensions.sh rollback --apply
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

默认沿用检测到的容器镜像与数据目录。只有特殊部署才需要环境变量，不能通过命令参数传 Token：

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

长期运行容器里的工作台只选择**已经安装**的扩展，并编辑配置；宿主命令通过隔离的 TUI 请求阶段提供完整安装流程，两个入口共用安装能力；运行页提供宿主 Docker 操作步骤。Web 和 CLI 不会就地安装、更新或卸载隔离模式的在线依赖；仍可按原有流程停用账号出口。HF 的旧扩展恢复机制保持独立，不适用此宿主协调器。

## 需要构建脚本的依赖

默认不执行任何第三方安装脚本。如果某个依赖确实需要构建，必须明确指定允许的包名：

```bash
ONEBOTS_ALLOW_BUILD='需要构建的包名' \
sh scripts/docker-extensions.sh install icqq
```

这些脚本只在无凭据、无网络的验证容器中执行。需要联网的 postinstall、缺少编译工具或不兼容 Alpine 的依赖会失败；应准备具备所需工具的同一基础镜像，不能通过给验证容器补回 Token 来绕过。允许构建的包仍是你信任的代码，扩展实际运行时也拥有网关进程的配置和数据访问能力。

## 回滚与故障排查

无需查找版本 ID：

```bash
sh scripts/docker-extensions.sh rollback --apply
```

在安装锁内自动读取当前版本，防止覆盖其他操作的切换；自动化也可显式传入期望的当前版本 ID。首次隔离安装也可以回退到原有 `/data/extensions` 布局。旧版本目录不会自动删除；确认不再用于回滚、且没有进程使用后再清理。回滚扩展不会回滚账号配置或数据库。

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

## 开发者：复用安装能力

`onebots` 导出 `createInstallationPlan`、`InstallationOperation` 和执行后端。计划统一解析可信扩展版本、必需 peer 和框架协议要求；后端负责具体环境中的执行。TUI 只收集输入与展示进度，不再维护另一套安装计划。

```ts
import { createInstallationPlan, InstallationOperation, createLocalInstallationBackend } from 'onebots';

const plan = createInstallationPlan({
    adapters: ['telegram'],
    protocols: ['onebot-v11'],
    applications: ['nonebot'],
});
const installation = new InstallationOperation(plan, createLocalInstallationBackend(), process.cwd());
await installation.run(''); // 使用已有 npm 认证；也可传入本次安装凭据，勿记录日志。
```

验证失败后再次调用同一操作的 `run()` 只重试验证，不重复安装。Docker 使用 `createDockerRequestBackend` 生成临时请求，状态为 `requested`，并不表示依赖已安装；宿主执行隔离下载、离线验证和版本切换后才进入配置。请求文件不含凭据，认证文件不会挂载到配置工作台或运行网关。安装本身不会开启账号出口。

:::
