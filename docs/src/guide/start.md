# 快速开始

::: tip 版本边界
本文适用于支持工作区来源登记的 OneBots 版本。旧 control v1 服务按[离线升级流程](/guide/workspace-admission)处理；更早的单进程 legacy 不能直接执行严格版 `onebots migrate`。不要混用旧入口、旧脚本和新运行时。
:::

## 从源码启动管理端（Linux/macOS）

使用 Node.js 24 及仓库指定的 pnpm。在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
umask 077
mkdir -m 700 ./workspace ./workspace-authority
node packages/onebots/lib/bin.js workspace plan --data-dir ./workspace \
  --authority-dir ./workspace-authority > workspace-plan.json
# 阅读计划和会话失效影响，使用计划中的实际 digest 明确确认。
node packages/onebots/lib/bin.js workspace register \
  --plan-file workspace-plan.json --confirm '<plan.digest>'
node packages/onebots/lib/bin.js serve --data-dir ./workspace \
  --authority-dir ./workspace-authority
```

上例只适用于全新空目录；计划文件留在 `workspace/` 之外。authority 必须独立持久保存，重启沿用同一路径，不随业务备份复制。登记本身不启动管理服务或网关；未登记的服务只提供只读维护页，不能配对。

保持最后一条命令的终端运行。空工作区不需要预填账号、协议或框架。另开终端生成首次配对码：

```sh
node packages/onebots/lib/bin.js auth bootstrap --data-dir ./workspace
```

访问管理地址（默认 `http://127.0.0.1:6727`），输入设备码。配对后使用会话登录，不使用旧用户名密码或手工配置的管理 `access_token`。详见[管理端登录与恢复](/guide/management-login)。

Windows 构建由 Node.js 清理产物，无需 Git Bash。全新 Windows 部署请使用下方的**管理员安装脚本**准备私有目录 ACL、SCM 服务及离线登记指引，不照搬 POSIX `mkdir` 命令。普通前台 `serve` 不提供 SCM 的受保护本地管理管道；一次性部署码也不能代替来源登记或授权接管旧工作区。现有 native 安装缺完整退出证明时不支持直接首次登记，详见[Windows 边界](/guide/workspace-admission#windows-与证明边界)。

在 Web「扩展」选择平台适配器、输出协议和框架，核对完整安装清单后确认。私有模块的下载授权只用于本次安装；必需 peer 一起安装并验证。验证通过后单独应用运行版本。随后在「账号」添加并保存账号，再到「协议」为该账号添加并保存出口；平台要求扫码或验证时，在「待办」完成。安装依赖不会自动启用平台连接。

管理页面使用 `/console` 下的路径，例如 `/console/accounts` 和 `/console/protocols`，可以直接访问、刷新或收藏；协议 API 仍使用各账号的协议地址，不在 `/console` 下。

也可在另一个交互终端运行：

```sh
node packages/onebots/lib/bin.js ui --data-dir ./workspace
```

网关停止或启动失败时，管理端仍然在线。使用管理端查看状态、修复配置、查询安装任务，再决定启动网关。

## 首次引导脚本

脚本由文档站直接提供：[Linux/macOS 安装脚本](/install.sh) · [Windows 安装脚本](/install.ps1)。无需克隆仓库。

Linux/macOS，在普通用户终端中执行：

```sh
curl -fsSL https://onebots.pages.dev/install.sh -o install.sh && sh install.sh
```

Windows，在**管理员 PowerShell** 中下载，确认下载成功后执行：

```powershell
Invoke-WebRequest https://onebots.pages.dev/install.ps1 -OutFile install.ps1 -ErrorAction Stop
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

可以先查看下载的脚本再执行。Windows 的 `Bypass` 仅作用于本次 PowerShell 进程，不修改系统执行策略。脚本默认使用用户目录下的 `.onebots`，已有安装请按升级或迁移流程处理。

`install.sh` 安装公开主程序与匹配 Web 产物，检查来源登记能力后安装用户级服务，并确认服务保持停止，再打印需你阅读、确认和执行的计划、登记、启动及配对命令。它不代为确认登记，不生成账号或长期凭据。Windows 的 `install.ps1` 额外校验随包 SCM 原生宿主并安装系统级服务。源码均位于 `docs/src/public`。

**脚本从公开 npm 下载程序，只有发布包含来源登记能力的版本后才能完成安装。** 缺工件或能力不匹配时会保留候选目录并失败，不退回旧 CLI。当前工作流使用源码打包产物检查真实 systemd、launchd 和管理进程恢复；只有对应任务通过才构成该版本的平台证据，不等同于 npm 已发布。

重复执行已完成的安装不会更新程序或重启服务。发现旧配置、旧运行目录或未完成安装时不会覆盖，请先核查状态并使用迁移/恢复流程。管理程序升级使用 `onebots update --manager`，不能通过重复执行安装脚本完成；网关运行版本则由管理端统一升级。详见[升级网关与管理程序](/guide/runtime-update)。

Windows 的 SCM 原生宿主、命名管道、访问控制、首次引导和服务生命周期已纳入 Windows 实机 CI。请在管理员 PowerShell 中运行 `install.ps1`；脚本只接受空安装目录，隔离公开包下载环境，验证管理端、网关与原生宿主工件后才调用统一 CLI 安装系统服务。它安装公开 npm 版本，**不会**安装当前未发布的源码改动。失败会保留候选证据，不自动回滚或重派系统动作。

## 系统托管

全新 Linux/macOS 用户级服务示例（工作区与 authority 互不包含，计划放在业务目录之外）：

```sh
onebots install --data-dir "$HOME/onebots-data" --authority-dir "$HOME/onebots-authority"
# 服务保持停止。阅读计划，确认会话失效影响后再登记。
onebots workspace plan --data-dir "$HOME/onebots-data" \
  --authority-dir "$HOME/onebots-authority" > "$HOME/onebots-plan.json"
onebots workspace register --plan-file "$HOME/onebots-plan.json" --confirm '<plan.digest>'
onebots start
onebots auth bootstrap --data-dir "$HOME/onebots-data"
```

已按上方源码流程登记、现在改为系统托管时，先正常关闭前台进程，再用相同 `--data-dir` 和 `--authority-dir` 执行 `install`、`start`，不重复登记。更换 authority 不属于程序升级。旧安装不要覆盖服务定义，按[离线升级与恢复边界](/guide/workspace-admission)处理。

系统托管维护管理服务；CLI、TUI 和 Web 通过同一控制接口管理独立网关。平台生命周期、故障回退和升级的实际支持以该版本对应 CI 与部署验收为准；源码实现不等于 Windows、完整机器重启或真实业务账号恢复已通过验收。普通数据卷副本防双开不提供跨主机 HA 或整机克隆之间的全局互斥。

继续阅读[首次安装与工作台](/local/first-run)和[系统服务](/local/service)，按运行方式完成扩展选择、账号配置和日常启停。
