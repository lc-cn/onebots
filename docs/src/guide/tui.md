# 终端安装与管理

`onebots tui` 在终端里完成扩展安装、账号配置、协议启用和服务管理。操作使用方向键选择、空格多选、Enter 确认、Esc 返回；无需提前记住适配器包名或编写 YAML。

## 进入向导

已有 OneBots 时，在其运行目录执行：

```bash
onebots tui -c config.yaml
```

首次没有配置文件时自动进入安装向导。交互式 `onebots setup`、没有配置文件时直接运行 `onebots`，也会进入同一向导。已有配置时，`onebots ui` 面板按 `c` 可进入安装与配置菜单。

首次安装推荐在交互式终端下载并运行官方脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/lc-cn/onebots/master/install.sh -o install-onebots.sh
sh install-onebots.sh
```

脚本先准备 Node.js、OneBots 主程序及其 Web 依赖，然后进入向导。适配器与协议依赖在确认选择后安装。通过管道执行脚本或设置 `ONEBOTS_NONINTERACTIVE=1` 时，继续使用原有自动部署流程。

也可以在 Node.js 24 或更新版本下创建本地运行目录：

```bash
mkdir my-onebots
cd my-onebots
npm init -y
npm install onebots
npx onebots tui
```

## 安装顺序

1. **选择适配器**：勾选要连接的平台，可同时选择多个。
2. **填写安装凭据**：选择 ICQQ 时，输入有 `@icqqjs` 包读取权限、包含 `read:packages` 的 GitHub Packages Token。输入隐藏；留空使用已有 npm 认证。该 Token 不会写入 OneBots 配置或安装摘要，临时认证文件在安装结束后删除。
3. **选择输出协议**：勾选 OneBot v11/v12、Satori、Milky 或 MCP。
4. **选择框架方案**：可选 Zhin、Koishi、NoneBot 等现有方案，列表显示协议及验证阶段。框架所需协议未勾选时会返回选择页，不会自动加装或启用。框架程序本身仍在下游部署。
5. **确认安装计划**：查看运行目录、精确依赖版本、框架选择与凭据状态。返回可以重新选择；取消不会开始安装。
6. **安装并验证**：复用运行目录的 npm/pnpm，安装当前 OneBots 版本目录指定的依赖，然后核对包入口、版本及插件注册。全部通过才进入配置阶段。

## 配置账号与协议

依赖验证通过后，选择“添加平台账号”，按适配器 Schema 输入账号标识、平台凭据和连接方式。平台 Token 与安装用的 GitHub Token 是两类凭据；前者会保存到账号配置，用于运行时连接平台。

表单支持枚举、布尔值、数字、敏感字段、条件字段和列表项。已有敏感值不会显示，留空保留。可选分组可以跳过；复杂对象的底层字段可通过 Web 配置表单继续编辑。

填写账号后，明确勾选该账号要启用的协议，并填写 HTTP、WebSocket、反向连接等协议 Schema 字段。只安装协议包不会自动给账号开放出口。完成后确认保存；已有配置备份为 `.bak`，配置文件以私有权限写入。

“查看下游框架连接配置”会根据框架、账号和可达地址生成两端配置模板。核对连接方向与鉴权码，再按模板配置下游框架。修改 OneBots 账号后，从管理菜单重启服务应用配置。

## 日常管理

管理菜单提供配置账号与协议、调整扩展选择、连接模板、安装守护服务、启动、停止、重启、状态、最近日志、诊断和打开 Web 管理端。

```bash
onebots tui --setup       # 重新选择和安装扩展
onebots tui --configure   # 验证已选插件，直接配置账号
onebots tui --system      # 管理系统级服务
```

配置中的 `plugins` 会保存适配器、协议与框架选择，后续无需重复输入 `-r/-p/-t`。管理凭据可从配置的 `access_token` 字段读取。

## 失败后如何继续

- **ICQQ 安装被拒绝**：核对 Token 的 `read:packages` 权限及包访问资格，再进入安装菜单输入凭据。
- **下载失败**：检查网络与 registry，再重新执行向导。已完成的依赖保留，失败不会更新账号配置。
- **插件加载失败**：执行 `onebots doctor -c config.yaml`，按诊断修复缺少的依赖或不兼容版本；验证成功后才能继续配置。
- **配置保存失败**：检查必填字段及账号协议配置；文件被其他进程改动时，重新进入配置菜单读取最新内容。
- **框架连不上**：在管理菜单查看服务状态、日志、连接模板；确认框架能访问配置的地址，协议方向、端口和鉴权一致。

非交互终端不支持 TUI。CI 和自动化部署继续使用 `setup`、`install`、`start`、`doctor` 等命令。
