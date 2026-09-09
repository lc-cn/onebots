# OneBots

[OneBots](https://github.com/lc-cn/onebots) 是多平台、多协议 IM 机器人网关。容器运行常驻管理服务，由它控制独立网关进程；网关停止或配置损坏时，Web 管理仍可使用。

## 首次使用

1. 将宿主机目录完整挂载到 **`/data`**。这里保存配置、设备会话、操作记录、已验证运行版本、数据库和业务数据，容器重建时必须保留。
2. 空数据卷会直接启动管理端，不会预填平台、账号、协议或框架。在宿主终端执行：

   ```sh
   docker exec --user 1000:1000 onebots \
     node /app/packages/onebots/lib/bin.js auth bootstrap --data-dir /data
   ```

3. 访问面板映射到容器 **6727** 的地址，在五分钟内输入设备码。管理登录使用设备会话，不使用旧用户名密码或配置中的管理 `access_token`。
4. 在 Web 或 TUI 中选择适配器、输出协议和框架，核对依赖计划后安装并验证，再显式激活运行版本。之后填写账号和协议配置并启动网关。

Web、TUI 与 CLI 共用管理服务的控制接口。安装依赖不会自动启用平台或协议；停止网关也不会停止管理服务。不要修改容器命令来添加旧 `-r/-p/-t` 参数，不要在活动目录手工运行包管理器，也不要挂载 Docker socket。

## 镜像

默认使用 **`ghcr.io/lc-cn/onebots:<版本>`**。镜像标签必须与 CI 实际发布产物一致；本目录中的版本号只表示 1Panel 应用目录，不代表新架构已经发布。

## 文档

仓库内 [Docker 说明](../../../docs/src/guide/docker.md) 与[快速开始](../../../docs/src/guide/start.md)。
