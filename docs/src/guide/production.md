# 生产部署

生产环境中的 OneBots 由常驻管理服务、按需运行的网关进程和系统托管组成。CLI、TUI 与 Web 都通过管理服务执行安装、配置、升级和生命周期操作。停止网关后，管理服务和 Web 控制台仍应可用。

## 安装系统服务

为工作区选择持久、权限受限的目录。不要把配置和运行版本放在临时目录中。

```bash
# 用户级服务
onebots install --data-dir /srv/onebots
onebots start

# Linux 系统级服务
sudo onebots install --system --data-dir /var/lib/onebots
sudo onebots start --system
```

`install` 创建管理服务定义和不可变运行候选，但不预填账号、协议或平台密钥，也不自动连接平台。Docker 中以前台 `onebots serve --data-dir /data` 作为容器主进程，并持久挂载 `/data`；不要在容器内再安装系统服务。

旧部署先执行 `onebots migrate`。迁移会检查旧服务定义、数据目录和配置，形成可恢复操作记录；不要直接覆盖旧服务定义。

## 管理端认证

管理端只接受设备配对和可撤销的设备会话。首次部署时在管理服务所在机器签发一次性设备码：

```bash
onebots auth bootstrap --data-dir /srv/onebots
```

设备码应通过可信的运维通道交给管理员，并在有效期内使用。增加浏览器或恢复访问时也必须从管理服务所在机器发起：

```bash
onebots auth device --data-dir /srv/onebots
onebots auth recover --data-dir /srv/onebots
```

业务配置中的根级 `username`、`password` 和 `access_token` 不用于管理端登录，也不会进入网关配置快照。

OneBot、Milky、Satori、MCP 等协议的 `access_token`、`token` 与 HMAC 密钥仍是协议业务配置。它们只保护对应 API、事件传输或回调，必须独立生成、最小范围分配并定期轮换。

## 安装扩展

通过 Web 或 TUI 创建安装计划，选择平台适配器、输出协议和框架扩展。计划应同时解析主包、必要 peer 依赖、下载授权和目标运行版本。

```bash
onebots ui --data-dir /srv/onebots
```

生产操作按以下边界执行：

1. 生成并确认安装计划。
2. 下载到隔离候选目录，不把私有 registry token 写入镜像层、日志或业务配置。
3. 校验包入口、Schema、注册契约和工件边界。
4. 显式激活已验证的不可变候选版本。
5. 配置账号与协议，校验并应用。
6. 通过管理服务启动或重启网关。

安装、激活、配置和启动是不同操作。任何一步失败都不应替换当前活动版本。私有包 token 只在安装操作期间注入临时 npm 配置，完成后立即清理。

## 配置与启动

配置在连接平台前按活动扩展提供的 Schema 校验。无效草稿不能替换活动配置；运行态应用失败时，文件和运行态都恢复到上一版本。

```bash
onebots doctor --data-dir /srv/onebots --json --strict
onebots control start --data-dir /srv/onebots
onebots control status --data-dir /srv/onebots
```

`doctor --strict` 适合作为部署门禁。它检查工作区权限、活动运行版本、插件入口与注册契约、配置 Schema、数据库路径以及服务状态。平台真实凭据仍需在目标环境做独立连通性验证。

网关生命周期命令不会停止管理服务：

```bash
onebots control stop --data-dir /srv/onebots
onebots control restart --data-dir /srv/onebots
```

只有需要维护管理面或系统定义时才使用 `onebots stop`、`restart` 和 `uninstall`。卸载系统服务不应删除工作区、账号配置或操作记录。

## 网络与密钥

- 默认只在受信任网络暴露管理地址；跨主机访问应放在 TLS 反向代理或受控隧道后。
- 限制工作区、设备会话、平台密钥和临时 npm 凭据的文件权限。
- 为每个协议出口使用独立 token，不复用设备配对材料或平台密钥。
- 回调协议启用 HMAC 或规范要求的签名校验，并限制目标地址与重试策略。
- 不把真实凭据写入镜像、仓库、命令历史、构建日志或诊断包。

## 运维与恢复

```bash
onebots status --json
onebots logs
onebots update --check --data-dir /srv/onebots
```

安装、迁移、更新和配置应用都应具有可查询的操作 ID。进程中断或结果未知时，先查看操作记录并执行恢复，不要盲目重复外部安装或切换：

```bash
onebots recover --operation <operation-id>
```

备份至少包含工作区配置、设备授权状态、数据库、活动运行版本引用和操作记录。恢复演练要验证管理服务能在网关失败时独立启动，并能回滚到上一已验证版本。

## 上线检查

- 管理服务由目标操作系统托管，并能在异常退出后恢复。
- Web 登录已通过设备配对验证，旧管理凭据无法登录。
- 停止网关后，管理服务、Web 和控制命令仍可用。
- 活动版本只包含已验证的适配器、协议和框架工件。
- 配置严格校验通过，并完成真实平台账号连接测试。
- 每种启用协议的 HTTP、WebSocket、回调或 SSE 鉴权与事件链路已验证。
- 日志、磁盘、端口、数据库和操作记录已有监控与备份。
- 更新失败和进程中断能够回滚或恢复，数据目录保持不变。

## 相关文档

- [全局配置](/config/global)
- [Docker 部署](/guide/docker)
- [故障排查](/troubleshooting/)
