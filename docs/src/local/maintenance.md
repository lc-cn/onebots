# 备份、升级与恢复

## 备份工作区

工作区至少包含：

- `config.yaml` 和配置历史；
- 设备授权与管理会话状态；
- 数据库和平台账号数据；
- `.control` 中的活动运行版本引用、候选、安装与操作记录；
- 管理服务和网关日志。

备份整个工作区，不要只复制 `config.yaml`。为得到一致快照，先停止网关；备份工具无法保证运行中文件一致性时，再停止管理服务：

```bash
onebots control stop --data-dir /path/to/data
onebots status --json
onebots stop
```

备份完成后按原顺序启动管理服务，再恢复网关期望状态。系统级服务命令追加 `--system`。

不要在普通备份中导出或展示私有仓库 Token。它只应存在于单次安装输入中。

## 升级网关运行版本

网关版本包含已选择的适配器、协议、框架和必需 peer。先只读检查：

```bash
onebots update --check --data-dir /path/to/data
```

交互执行：

```bash
onebots update --data-dir /path/to/data
```

命令会先生成计划，再安装并验证候选，最后单独确认激活。当前活动版本不会被原地覆盖。完整的非交互流程见 [CLI 命令索引](/local/cli#扩展安装与移除)。

## 升级管理程序

原生系统服务先检查，再执行交互升级：

```bash
onebots update --manager --check
onebots update --manager
```

自动化必须指定精确版本和确认参数：

```bash
onebots update --manager --version <精确版本> --yes
```

系统级服务追加 `--system`。管理程序使用独立候选，不会在当前安装目录执行 `npm install`。Docker 和 Hugging Face 部署通过替换镜像升级，不运行 `update --manager`。

OneBots 的发布只使用 patch 版本，但升级前仍应核对变更说明、运行版本计划和备份状态。

## 处理未知结果

安装、激活、配置应用、服务迁移和管理程序升级都会产生操作或任务 ID。超时、终端断开或进程退出不代表操作失败，也不允许自动重做。

```bash
# 查询扩展安装任务
onebots control installation --data-dir /path/to/data --request <原任务ID>

# 对账系统服务操作，不重放副作用
onebots recover --operation <原操作ID>

# 管理程序仍处于候选阶段时，继续核对同一升级
onebots update --manager --operation <原操作ID> --version <精确版本>
```

只有明确需要回退时才选择对应动作：

```bash
onebots recover --operation <原操作ID> --rollback-upgrade
onebots recover --operation <原操作ID> --rollback-migration
```

系统级操作追加 `--system`。回退前保留候选目录、操作记录和日志；不要删除这些证据后重新安装。

## 恢复演练

至少验证以下结果：

1. 从备份恢复整个工作区后，管理服务可以独立启动。
2. 网关保持停止时，Web、TUI、`status` 和诊断仍可用。
3. 活动运行版本引用的包入口和注册契约通过 `doctor --strict`。
4. 启动网关后，真实账号重新连接，协议鉴权和事件链路可用。
5. 上一次结果未知的操作仍能按原 ID 查询或对账。

配置文件能读取不等于恢复完成；真实平台凭据、网络回调和下游框架连接必须在目标环境单独验证。

## Docker 升级

1. 备份并持续挂载整个 `/data`。
2. 拉取明确版本或发布标签的镜像。
3. 重建容器，不改变 `/data` 挂载和运行用户。
4. 先验证管理服务 `/ready` 和 Web 登录。
5. 再运行 `doctor --data-dir /data --json --strict`，最后验证网关与真实账号。

不要只挂载 `config.yaml`，也不要把 `/data/.control` 留在临时容器层。私有扩展需要在新镜像环境中复核原生依赖兼容性。
