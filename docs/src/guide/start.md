# 快速开始

::: warning 新架构尚未发布
本文描述 `codex/service-architecture` 分支。不要用现有 npm 稳定包或旧一键脚本更新该分支；发布前仍须通过原生系统迁移与冷启动验收。
:::

## 从源码启动管理端

使用 Node.js 24 及仓库指定的 pnpm。在重构分支根目录执行：

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

重构分支的 `install.sh` 用于 Linux/macOS 首次安装，安装主程序和匹配 Web 产物后调用管理服务的用户级安装、启动与状态命令。它不选择默认协议、不生成虚构账号、不输出长期凭据。

**脚本从公开 npm 下载程序，只有发布包含新管理服务的版本后才能完成安装。** 缺少新架构产物时会保留候选目录并明确失败，不运行旧 CLI。当前工作流会在 GitHub 托管的 Ubuntu 和 macOS runner 上，使用源码打包产物执行真实 systemd 系统级、launchd 用户级生命周期、旧服务迁移与管理进程异常退出恢复验收。只有对应任务通过才构成平台证据；这不等同于公开 npm 已发布。

重复执行已完成的安装不会更新程序或重启服务。发现旧配置、旧运行目录或未完成安装时不会覆盖，请先核查状态并使用迁移/恢复流程。管理程序升级使用 `onebots update --manager`，不能通过重复执行安装脚本完成；网关运行版本则由管理端统一升级。详见[升级网关与管理程序](/guide/runtime-update)。

Windows 已实现 SCM 原生宿主、命名管道、访问控制和服务生命周期命令，但最新 Windows 实机 CI 尚未通过，当前仍处于最终验证阶段。`install.ps1` 在验证完成前仍会在写盘前退出；生产使用请暂用 Docker Desktop，并按 [Docker 部署](/guide/docker)持久化 `/data`。不要运行旧脚本绕过此门禁。

## 系统托管

从已安装的新架构 CLI 执行 `onebots install --data-dir <工作区>` 安装用户级服务，之后执行 `onebots start`。首次服务安装不会启动网关账号或改写业务配置；已有旧服务应先迁移，不能用首次安装覆盖。

系统托管维护管理服务；CLI、TUI 和 Web 通过同一控制接口管理独立网关。Linux systemd 的原生生命周期、故障注入回退和 patch 升级已通过实机 CI；launchd 与 Windows 的最终实机任务仍在验证。发布时必须以对应平台任务的实际结果为准，完整机器重启和真实业务账号恢复仍需部署环境验收。
