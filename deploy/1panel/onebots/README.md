# OneBots

[OneBots](https://github.com/lc-cn/onebots) 是 **TypeScript / Node.js** 的多平台、多协议即时通讯机器人框架，可作为网关将 QQ、微信、Discord、Telegram、飞书、企业微信等接入 **OneBot v11/v12、Satori、Milky** 等协议。

## 使用说明

- **数据目录**：请将宿主机目录挂载到容器 **`/data`**，内含 `config.yaml`、SQLite 数据库等。
- **首次启动**：若 `/data/config.yaml` 不存在，镜像会自动从内置示例复制一份，请按需修改（账号、协议端口、Token 等）后重启。
- **Web 管理**：默认监听 **`6727`**，安装时在面板中映射该端口即可访问（具体路径见你所启用的协议配置）。

## 镜像

默认使用 **`ghcr.io/lc-cn/onebots:<版本>`**。若需跟踪最新构建，可将 compose 中镜像 tag 改为 CI 实际推送的分支 tag（如 `master`）。

## 文档

仓库内 [Docker 说明](../../../docs/src/guide/docker.md) 与 [快速开始](https://github.com/lc-cn/onebots)。
