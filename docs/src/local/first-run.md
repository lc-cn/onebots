# 首次安装与工作台

## 1. 安装命令行

需要 Node.js 24 或更高版本。使用 npm 安装公开的 OneBots 主程序：

```bash
npm install --global onebots
onebots --version
```

从源码运行时，先在仓库根目录执行 `pnpm install --frozen-lockfile` 和 `pnpm build`，再把下文的 `onebots` 替换为 `node packages/onebots/lib/bin.js`。

## 2. 选择运行方式

先试用或由其他进程托管时，可以前台运行：

```bash
onebots serve --data-dir "$HOME/onebots-data"
```

管理服务默认监听 `127.0.0.1:6727`。需要常驻运行时，按[系统服务](/local/service)安装；不要同时以前台和系统服务方式占用同一工作区。

## 3. 打开工作台

在另一个交互式终端连接同一工作区：

```bash
onebots ui --data-dir "$HOME/onebots-data"
```

`onebots tui` 是同一工作台的兼容入口。也可以直接进入指定向导：

```bash
onebots setup --data-dir "$HOME/onebots-data"
onebots ui --data-dir "$HOME/onebots-data" --configure
```

工作台只连接已经运行的管理服务，不会私自启动旧网关或覆盖配置。

## 4. 安装扩展

在“安装与扩展”中按顺序操作：

1. 选择需要的平台适配器、输出协议和框架。
2. 核对计划中的主包、必需 peer 和移除项。
3. 如果计划包含私有包，按提示输入本次下载授权。
4. 等待候选版本安装并验证。
5. 明确激活通过验证的候选版本。

扩展选择代表**下一运行版本的完整集合**。取消勾选会形成移除计划；被账号、协议出口或 `plugins` 引用的扩展不能直接移除。先删除相关业务配置并应用，再重新生成计划。

私有包授权只用于本次安装，不应写入 `config.yaml`、shell 历史或长期 `.npmrc`。ICQQ 与 `@icqqjs/icqq` 的 Docker 安装方式见 [Docker 私有扩展](/guide/docker-private-extensions)。

## 5. 配置并启动网关

1. 创建平台账号，填写平台密钥或登录信息。
2. 创建协议出口，确认监听地址、路径和协议鉴权。
3. 校验配置草稿。
4. 明确应用配置。
5. 启动网关，检查账号状态和协议连接。

安装扩展、应用配置和启动网关是三个独立操作。安装成功不会自动连接平台，应用配置也不会绕过网关的启停状态。

## 6. 登录 Web

首次配对码必须在管理服务所在机器签发：

```bash
onebots auth bootstrap --data-dir "$HOME/onebots-data"
```

访问 `http://127.0.0.1:6727` 并输入设备码。新增浏览器使用 `auth device`，凭证丢失使用 `auth recover`。恢复配对完成后旧设备会话才失效。详见[管理端登录与恢复](/guide/management-login)。

## Docker 的差异

容器以 `onebots serve --data-dir /data` 作为主进程，并持久挂载整个 `/data`。进入 TUI：

```bash
docker exec -it --user 1000:1000 onebots onebots ui --data-dir /data
```

不要在容器内执行 `onebots install`，也不要预填适配器、协议、账号或平台密钥。空工作区应能启动管理服务，再从 Web 或 TUI 完成安装和配置。
