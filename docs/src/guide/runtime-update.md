# 升级网关运行版本

::: warning 重构分支功能
本文适用于 `codex/service-architecture` 分支，尚未发布到 master。此流程升级独立网关及其扩展，不更新常驻管理服务或 CLI 程序。Docker 镜像更新仍需替换镜像并保留数据卷。
:::

管理服务必须在线，配置应可正常读取。网关可以处于停止状态；升级保留其启停意图，不会自动启用账号或协议。

## Web

在依赖安装面板点击“检查网关升级”，核对当前与目标版本，再确认安装。检查可能需要两分钟；期间不会安装依赖或切换网关。验证通过后点击应用，仍使用原安装任务的跟踪与恢复入口。有未处理安装任务时，先查询其结果。

## TUI

运行 `onebots ui --data-dir <工作区>`，选择“升级网关运行版本”。工作台显示当前和目标包版本，再让你确认安装。私有模块所需的 GitHub Packages `read:packages` 授权仅在确认安装后输入，只用于这次下载。

依赖下载并验证通过后，单独确认激活。不要因等待超时重新创建安装任务：使用工作台中的“查询已有安装任务”，输入先前显示的任务 ID。

## CLI

先生成计划，不会下载或激活依赖：

```sh
onebots control plan-update --data-dir <工作区>
```

结果为 `current` 时无需安装；`updates_available` 包含版本比较和 `installationPlan`。核对后使用同一个计划 ID：

```sh
onebots control install --data-dir <工作区> --plan <installationPlan.id> --request <本次唯一任务ID>
onebots control installation --data-dir <工作区> --request <同一任务ID>
```

私有授权通过安全管道传入安装命令的 `--auth-stdin`，不要写进命令参数或配置文件。只有任务达到 `verified` 后，才可主动激活其 `candidateId`：

```sh
onebots control activate --data-dir <工作区> --generation <candidateId>
```

## 失败处理

- 配置或运行版本在确认后发生变化：刷新状态，重新生成并核对计划；旧计划不能覆盖新状态。
- 下载或提交结果不明：查询原任务，不重新派发。验证失败的版本不会自动激活。
- 配置损坏：先通过管理端修复配置，再检查更新。
- 发布源版本更旧、目录缺失或版本组合不一致：停止升级并核对当前安装。系统不会自动降级或回退到旧目录。

已安装但未启用的扩展也会保留在升级清单中。必需 peer 显示的是依赖范围，安装验证通过才说明实际依赖组合可加载；检查到更新不代表已经升级成功。
