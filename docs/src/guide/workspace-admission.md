# 工作区登记与离线升级

工作区的数据卷与卷外身份目录必须分别持久保存。身份目录不属于可移植业务备份，不要随 `/data`、`.control` 或整机镜像一起复制。首次登记需要在本机明确确认；Web 配对码和复制出的旧浏览器会话不能授权登记。

## 已有 POSIX 系统服务升级

此路径仅适用于已有完整正常关闭证据的 **control v1 常驻管理服务**。更早的单进程 legacy 部署不能直接执行严格版 `onebots migrate`：新版本会在记录操作、备份和停止旧服务之前明确拒绝。需要维护者先使用支持旧迁移的版本完成 legacy → control v1，并正常关闭，再执行下面的离线更新。严格版不会代为下载、启动旧程序或静默绑定旧目录；历史迁移记录仍可只读诊断、按原恢复入口核验。

以下命令须使用**新版本 CLI**，不要用正在运行的旧管理程序自身执行更新。先保留完整数据备份、旧程序工件及服务记录。系统级服务为下面的 `stop`、`update`、`start` 增加 `--system`，并使用相应管理员权限。

```bash
# 先正常关闭；无法确认旧网关/worker 退出时停止升级，保留现场。
onebots stop

# 在已停止服务上复用候选验证、服务定义及 metadata 的受控切换事务。
# 路径必须与工作区互不包含；已有 v2 服务升级不能更换此路径。
onebots update --manager --yes --authority-dir /srv/onebots-authority

# 服务仍保持停止。计划不创建 authority，不改认证或业务状态。
onebots workspace plan --data-dir /srv/onebots-data \
  --authority-dir /srv/onebots-authority > plan.json

# 核对计划中的目录、旧状态和管理会话失效影响；使用实际 JSON 中的 digest。
onebots workspace register --plan-file plan.json --confirm '<plan.digest>'

onebots start
```

`/srv/onebots-data` 应替换为原服务工作区，不能通过换目录规避旧进程检查。`authority` 的父目录必须已经由部署准备；CLI 不递归创建或修改任意祖先。系统服务默认身份目录为对应 scope 的状态目录下 `authority`，例如 Linux 系统服务为 `/var/lib/onebots/authority`。若原工作区就是 `/var/lib/onebots`，必须像上例一样显式选择另一目录。

只有旧记录能证明正常关闭、没有未决配置/安装、worker 归属与退出可确认时才能首次登记。`active`、损坏或 foreign worker 等未知结果不能用确认参数忽略。

登记会撤销旧管理设备会话与未兑换码。服务启动后，已有配对部署运行 `onebots auth recover --data-dir /srv/onebots-data` 再在 Web 配对；尚未配对的新部署使用 `auth bootstrap`。业务账号会话和配置不因登记而重写。恢复码仅通过可信本机通道使用。

若登记结果未知，保留计划与 requestId；先只读检查，不另建身份：

```bash
onebots workspace inspect --data-dir /srv/onebots-data --authority-dir /srv/onebots-authority
onebots workspace resume --data-dir /srv/onebots-data \
  --authority-dir /srv/onebots-authority --request '<requestId>'
```

`resume` 只对账同一个已确认事务，不启动网关。引用、认证或登记状态不一致时保持维护状态；不删除 `.control`、不恢复旧 auth 字节，也不手动启动不认识来源检查的旧程序。

## Docker 升级

除 `/data` 外，增加独立命名卷挂载到 `/var/lib/onebots-authority`，新入口只会初始化其中全新的 `authority` 私有子目录。现有目录权限错误会明确拒绝，不递归修复。

先用旧镜像正常执行 `docker compose down`，保留旧数据、旧镜像及关闭证据，再更新镜像和 Compose 的第二个挂载。首次登记须在服务停止时，通过挂载**相同两个卷**的临时容器运行上述 `workspace plan/register`；业务工作区为 `/data`，身份目录为 `/var/lib/onebots-authority/authority`。确认登记后再 `docker compose up -d`。

```bash
docker compose down
docker compose run --rm --no-deps -T onebots workspace plan \
  --data-dir /data --authority-dir /var/lib/onebots-authority/authority > plan.json
# 核对实际计划，替换下面的摘要；确认文件在宿主 stdin 传入，不放进业务卷。
docker compose run --rm --no-deps -T onebots workspace register \
  --plan-file - --confirm '<plan.digest>' < plan.json
docker compose up -d
```

正常已登记的同卷重建保留管理会话与网关运行/停止意图；hostname 改变本身不触发重新配对。只复制业务数据卷而没有匹配来源证明的副本不能自行运行。身份目录丢失、物理对象身份变化或不支持的文件系统进入维护状态，不自动重建或重绑。

## Windows 与证明边界

全新 Windows 安装通过同一受信 native binary 的离线 helper 检查本地 NTFS/ReFS 的文件 ID 与私有 ACL；不依赖已经停止的 SCM 管道。当前旧 native 安装没有可离线核验的完整退出证据时，首次登记返回 `unsupported`。SCM stopped、PID 0 或管道不可达不能证明旧 worker 全部退出；需要另行交付兼容阶段，不提供人工勾选或杀历史 PID 的捷径。

本机制只阻止 authority 未随数据卷复制的普通副本自动运行。不保证完整 authority、主机或 VM 克隆之间的全局互斥，不提供跨主机自动容灾、强制重绑或完整 `.control` 导入。
