# Docker 私有扩展安装

官方镜像不预装 ICQQ 及 `@icqqjs/icqq`。需要私有包时，仍使用 OneBots 管理端的统一安装流程；不运行第二套宿主安装器，也不把 Docker socket 或长期 `.npmrc` 挂进容器。

## 安装

1. 按 [Docker 部署](/guide/docker)启动容器并挂载整个 `/data`。
2. 使用设备码登录 Web，打开依赖安装页；也可以运行：

   ```bash
   docker exec -it --user 1000:1000 onebots \
     onebots ui --data-dir /data --setup
   ```

3. 选择 ICQQ 适配器、所需输出协议和下游框架。安装计划会同时列出适配器的必需 peer。
4. 按提示输入具有 `read:packages` 和 `@icqqjs` 包访问资格的 GitHub Packages Token。它是下载授权，不是 QQ 登录密码。
5. 等待同一个安装任务完成验证，再显式激活候选运行版本。结果未知时查询原任务 ID，不创建新任务。
6. 在配置页填写 QQ 账号与协议连接参数，校验、应用后再启动网关。安装依赖不会自动启用账号或协议。

私有下载授权只传给本次下载子进程，随后从环境和临时文件中清除；不会写入 `config.yaml`、管理会话或网关环境。安装记录和不可变候选保存在 `/data/.control`，因此必须持久挂载整个 `/data`。

## 自动化

先创建并核对安装计划，再使用固定的计划 ID 和本次唯一任务 ID：

```bash
onebots control plan --data-dir /data --adapters icqq --protocols onebot-v11
printf '%s' "$GITHUB_PACKAGES_TOKEN" | \
  onebots control install --data-dir /data \
    --plan <计划ID> --request <唯一任务ID> --auth-stdin
onebots control installation --data-dir /data --request <同一任务ID>
onebots control activate --data-dir /data --generation <候选ID>
```

请在容器内或通过 `docker exec` 执行这些命令。Token 只从标准输入传入，不放在命令参数、环境持久化配置、Compose 文件或业务 YAML 中。只有安装状态为 `verified` 才能激活。

## 旧扩展目录

新架构不会从 `/data/extensions` 或 `ONEBOTS_EXTENSION_ROOT` 加载依赖，也不会将旧目录直接声明为已验证候选。升级旧部署时保留业务数据，通过当前管理端重新选择、下载、验证并激活扩展。确认新版本稳定且不再需要旧版回滚后，再在维护窗口处理旧目录。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 401/403 | 核对 Token 的 `read:packages` 权限、组织授权和包访问资格，继续查询原安装任务。 |
| 安装任务结果未知 | 使用原任务 ID 查询；不要重启容器或换 ID 重派下载。 |
| 候选验证失败 | 当前激活版本保持不变。检查 Node/Alpine 兼容性、必需 peer 和允许执行的构建脚本。 |
| 网关无法启动 | 管理端仍应在线。查看服务日志和诊断，修复配置或切回已验证候选。 |
| `/data` 权限错误 | 容器默认以 uid/gid 1000 运行；修正卷属主，不使用 `chmod 777`。 |
| 重建后依赖消失 | 确认挂载的是整个 `/data`，并且 `/data/.control` 随卷保留。 |

不要把带私有模块的派生镜像推送到公共仓库。确需构建固定私有镜像时，只能使用 BuildKit secret 提供 npm 凭据，并限制镜像与构建缓存的访问；不要使用 `ARG TOKEN`、`ENV TOKEN` 或先 `COPY .npmrc` 再删除。
