# 快速开始

::: tip 版本边界
本文适用于包含常驻管理服务的 OneBots 版本。旧安装应先执行迁移，不要混用旧入口、旧脚本和新管理运行时。
:::

## 从源码启动管理端

使用 Node.js 24 及仓库指定的 pnpm。在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/onebots/lib/bin.js serve --data-dir ./workspace
```

保持此终端运行。空工作区不需要预填平台账号、协议或框架；管理服务会提供 Web 控制台。另开终端生成首次配对码：

```sh
node packages/onebots/lib/bin.js auth bootstrap --data-dir ./workspace
```

访问管理地址（默认 `http://127.0.0.1:6727`），输入设备码。配对后使用会话登录，不使用旧用户名密码或手工配置的管理 `access_token`。详见[管理端登录与恢复](/guide/management-login)。

在 Web 安装面板选择平台适配器、输出协议和框架，核对完整安装清单后确认。私有模块的下载授权只用于本次安装；必需 peer 一起安装并验证。验证通过后单独激活运行版本，再填写平台账号与协议配置。安装依赖不会自动启用平台连接。

也可在另一个交互终端运行：

```sh
node packages/onebots/lib/bin.js ui --data-dir ./workspace
```

网关停止或启动失败时，管理端仍然在线。使用管理端查看状态、修复配置、查询安装任务，再决定启动网关。

## 首次引导脚本

`install.sh` 用于 Linux/macOS 首次安装，安装主程序和匹配 Web 产物后调用管理服务的用户级安装、启动与状态命令。它不选择默认协议、不生成虚构账号、不输出长期凭据。Windows 使用具有相同边界的 `install.ps1`，并额外校验随包 SCM 原生宿主。

**脚本从公开 npm 下载程序，只有发布包含新管理服务的版本后才能完成安装。** 缺少新架构产物时会保留候选目录并明确失败，不运行旧 CLI。当前工作流会在 GitHub 托管的 Ubuntu 和 macOS runner 上，使用源码打包产物执行真实 systemd 系统级、launchd 用户级生命周期、旧服务迁移与管理进程异常退出恢复验收。只有对应任务通过才构成平台证据；这不等同于公开 npm 已发布。

重复执行已完成的安装不会更新程序或重启服务。发现旧配置、旧运行目录或未完成安装时不会覆盖，请先核查状态并使用迁移/恢复流程。管理程序升级使用 `onebots update --manager`，不能通过重复执行安装脚本完成；网关运行版本则由管理端统一升级。详见[升级网关与管理程序](/guide/runtime-update)。

Windows 的 SCM 原生宿主、命名管道、访问控制、首次引导和服务生命周期已纳入 Windows 实机 CI。请在管理员 PowerShell 中运行 `install.ps1`；脚本只接受空安装目录，隔离公开包下载环境，验证管理端、网关与原生宿主工件后才调用统一 CLI 安装系统服务。失败会保留候选证据，不自动回滚或重派系统动作。

## 系统托管

从已安装的新架构 CLI 执行 `onebots install --data-dir <工作区>` 安装用户级服务，之后执行 `onebots start`。首次服务安装不会启动网关账号或改写业务配置；已有旧服务应先迁移，不能用首次安装覆盖。

系统托管维护管理服务；CLI、TUI 和 Web 通过同一控制接口管理独立网关。Linux systemd、macOS launchd 和 Windows SCM 的原生生命周期、旧服务迁移、故障回退和 patch 升级均已通过对应平台 CI。完整机器重启和真实业务账号恢复仍需部署环境验收。

继续阅读[首次安装与工作台](/local/first-run)和[系统服务](/local/service)，按运行方式完成扩展选择、账号配置和日常启停。
