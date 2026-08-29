# AGENTS.md — OneBots 项目指南

> 本文件面向 AI 编码代理（coding agents）。阅读本文后应能在不了解项目背景的情况下正确地进行构建、测试与代码修改。
> 项目文档与代码注释主要使用中文；变量、函数、类型等代码标识符使用英文。

---

## 项目概述

**OneBots** 是一个多平台、多协议的即时通讯（IM）机器人网关与框架（TypeScript / Node.js，pnpm monorepo）。
它的定位是「自托管的 IM 机器人中台 + 协议出口」：在一个进程里接入多个 IM 平台，再以一套或多套开放协议暴露给下游插件 / 业务。

数据流：

```
IM 平台原始事件 → Adapter（适配器）→ Account + id_map（统一 CommonEvent + ID 映射）
                → Protocol（协议层）→ 下游客户端（OneBot / Satori / Milky 生态）
```

- **Adapter（适配器）**：把各平台原始事件与 API 归一化为统一的 `CommonEvent` + 通用 Adapter API。
- **Protocol（协议）**：把 `CommonEvent` 转成 OneBot v11/v12、Satori v1、Milky v1 等对外报文，并处理入站 API 调用（HTTP / WebSocket / WebHook / 反向 WS / SSE）。
- **`@onebots/core`**：账号、ID 映射（`createId` / `resolveId`）、路由、注册表（`AdapterRegistry` / `ProtocolRegistry`）、日志、错误体系等共用内核。
- **`onebots` 主包**：配置加载、插件加载、HTTP/WS 网关、CLI、可选 Web 管理端。

- 仓库：<https://github.com/lc-cn/onebots>（分支 `master`），许可证 MIT。
- 在线文档：<https://onebots.pages.dev>（VitePress，部署在 Cloudflare Pages）。
- 支持 18 个平台适配器（QQ 官方、ICQQ、微信公众号、企业微信、钉钉、飞书、Slack、Discord、Telegram、Kook、Teams、LINE、邮件、WhatsApp、Zulip、Mock 等）与 4 种对外协议。

---

## 技术栈与环境要求

| 工具 | 要求 |
|------|------|
| Node.js | **>= 24**（`package.json#engines`；`.node-version` / `.nvmrc` 推荐版本为 24，可用 `fnm use` / `nvm use` 切换） |
| pnpm | **>= 9.12.0**，锁定 `packageManager: pnpm@9.15.9`（Docker/CI 中用 corepack 激活该版本） |
| TypeScript | 5.9.3（通过 pnpm-workspace 的 `catalog:` 统一管理，子包 devDependencies 写 `"typescript": "catalog:"`） |

- 全仓库 **ESM**（各包 `package.json` 均为 `"type": "module"`），**禁止 CommonJS**。
- 构建：`tsc` + `tsc-alias`，产物输出到各包的 `lib/` 目录（`main`/`types` 指向 `lib/index.js` / `lib/index.d.ts`）。
- 测试框架：Vitest（配置见根目录 `vitest.config.ts`）。
- 文档：VitePress（`docs/`）。
- 版本管理：Changesets（`.changeset/`）。
- Web 网关基于 Koa（`koa`、`@koa/router`、`koa-body`、`koa-static`、`koa-basic-auth`），WebSocket 用 `ws`，日志用 `log4js`。
- Web 管理端（`packages/web`）：Vue 3 + Vite + Tailwind CSS v4 + 自研组件库（`packages/web/src/ui/`，禁止重新引入 Element Plus），图标用 `@tabler/icons-vue`，设计令牌集中在 `packages/web/src/styles/main.css`（明暗双主题，`.dark` class 切换）。

---

## 仓库结构（Monorepo）

pnpm workspace 包含：`packages/*`、`adapters/*`、`protocols/*/*`、`docs`、`development`（见 `pnpm-workspace.yaml`）。

```
onebots/
├── packages/
│   ├── core/          # @onebots/core — 核心抽象层：Adapter/Protocol 基类、Account、ID 映射、
│   │                  #   路由、日志、错误体系（errors.ts）、注册表、重试/熔断/限流等
│   ├── onebots/       # onebots — 网关主程序与 CLI（bin 入口 lib/bin.js）
│   │                  #   src/routes/ 下有 auth / config / adapter-api / terminal 等路由模块
│   ├── web/           # @onebots/web — Web 管理端
│   └── imhelper/      # imhelper — 客户端 SDK 核心（连接本网关或其他兼容实现）
├── adapters/          # 平台适配器 @onebots/adapter-*（共 18 个，如 adapter-qq、adapter-mock…）
├── protocols/         # 对外协议，每个协议目录含两个子包：
│   ├── onebot-v11/    #   protocol/ → @onebots/protocol-onebot-v11（服务端实现）
│   ├── onebot-v12/    #   sdk/      → @imhelper/onebot-v11（客户端 SDK）
│   ├── satori-v1/
│   └── milky-v1/
├── docs/              # VitePress 文档源码（@onebots/docs）
├── development/       # onebots-dev — 本地开发启动配置（pnpm dev 实际入口）
├── __tests__/         # 集成 / 端到端协议测试（需要运行中的网关）
├── data/              # 本地运行时数据（config.yaml、日志等，勿提交敏感内容）
└── deploy/            # 部署相关（如 1panel）
```

**包命名约定**：

| 类型 | 包名 | 示例 |
|------|------|------|
| 核心包 | `@onebots/*` | `@onebots/core`、`@onebots/web` |
| 主应用 | `onebots` | CLI 命令 `onebots` |
| 适配器 | `@onebots/adapter-*` | `@onebots/adapter-qq` |
| 协议（服务端） | `@onebots/protocol-*` | `@onebots/protocol-onebot-v11` |
| 客户端 SDK | `imhelper` / `@imhelper/*` | `@imhelper/onebot-v11` |

**适配器内部文件命名**：`bot.ts`（有状态平台 SDK 包装）、`client.ts`（可独立嵌入的官方 API/传输客户端，二者按职责择一）、`adapter.ts`（适配器）、`types.ts`（类型）、`index.ts`（入口）。不要为兼容命名创建无逻辑的转发文件。

---

## 构建与常用命令

所有命令在仓库根目录执行：

```bash
pnpm install          # 安装依赖（CI 用 --frozen-lockfile；Docker 构建用 --no-frozen-lockfile）
pnpm build:packages   # 先构建 packages/*（首次 clone 必须执行，因内部存在依赖关系）
pnpm build            # 全量构建 = build:packages + protocols/adapters/docs/development
pnpm clean            # 清理各包 lib/ 与 *.tsbuildinfo
pnpm dev              # 启动开发网关（实际运行 development/ 包，加载真实适配器与 config.yaml）
pnpm test             # vitest run --passWithNoTests
pnpm test:watch       # vitest 监听模式
pnpm test:coverage    # 覆盖率报告（v8 provider）
pnpm lint             # eslint（仅检查 *.ts）
pnpm lint:fix         # eslint 自动修复
pnpm format           # prettier --check
pnpm format:fix       # prettier --write（ts/js/md）
pnpm docs:dev         # 文档站点（端口 8989）
pnpm web:dev          # Web 管理端前端开发
pnpm changeset        # 创建变更集（发版必需）
```

**注意**：

- 首次 clone 后必须先 `pnpm build:packages`，否则依赖 `lib/` 产物的下游包无法构建/运行。
- 修改 `packages/*` 后需要重新构建，协议/适配器包消费的是构建产物 `lib/`。
- CLI 加载机制：`onebots -r <adapter短名> -p <协议后缀>` 会按 `@onebots/adapter-<name>` → `onebots-adapter-<name>` → `<name>` 顺序尝试加载模块（协议同理加 `protocol-` 前缀）。
- 网关默认端口 **6727**；运行时配置文件为 `config.yaml`（`general` 写协议默认值，`{platform}.{account_id}` 下写账号与平台密钥）。

---

## 测试策略

- 配置：`vitest.config.ts`。Node 环境，超时 30s，`globals: true`，`pool: 'forks'`。
- 测试文件位置：
  - 单元测试：各包内 `packages/*/src/**/*.spec.ts`、`adapters/*/src/**`、`protocols/**` 及 `packages/core/src/__tests__/`。
  - 集成 / 协议测试：根目录 `__tests__/`（`onebot/`、`milky/`、`satori/`、`unit/`），多为 `.spec.js`，覆盖 HTTP API、鉴权、心跳、WebSocket、SSE、WebHook、反向 WS。
- **集成测试需要先有运行中的网关**（`pnpm dev`），并通过环境变量指定测试账号：

  ```bash
  export PLATFORM=dingtalk
  export ACCOUNT_ID=<account_id>
  pnpm test -- --run onebot/v11        # 按目录筛选运行
  ```

- 服务器不可用时应跳过（`console.log('⏭️ 跳过：服务器不可用'); return;`），不要让测试假失败。
- 单元测试使用 `@onebots/adapter-mock` 的 `MockBot`（可用 `bot.triggerEvent('message', {...})` 手动触发事件）。
- 覆盖率阈值（`test:coverage`）：lines 50 / functions 50 / branches 40 / statements 50。
- WebHook / 反向 WS 测试使用本地回环端口（默认 18080–18082，见 `__tests__/README.md`）。
- 别名的坑：`vitest.config.ts` 的 `resolve.alias` 中部分路径（如 `packages/protocol-onebot-v11`）指向的是旧目录名，实际协议代码在 `protocols/*/protocol/src`——改动相关测试时注意核对路径是否真实存在。

---

## 代码规范

来源：`CONTRIBUTING.md`、`.cursorrules`、`.prettierrc`、`eslint.config.mjs`、`tsconfig.json`。

### 模块与导入

- 纯 ESM；**相对路径导入必须带 `.js` 后缀**（`import { Account } from './account.js'`），TS `moduleResolution: nodenext`。
- 类型导入用 `import type`；混合导入用 `import { X, type Y }`。
- `packages/core` 内部可用 `@/` 别名（映射到 `packages/core/src`，构建时由 `tsc-alias` 重写）。
- 避免循环依赖；必要时把公共类型抽到独立的 `types.ts`。

### 类型

- **禁止 `any`**（eslint 对 `no-explicit-any` 告警）；外部 SDK 返回值用 `unknown` + 类型守卫。
- 对象类型优先 `interface`；`type` 仅用于联合/交叉/工具类型。
- 相关类型放进 namespace 组织（如 `Adapter.SendMessageParams`、`CommonTypes.Scene`）。
- `strict: true`。

### ID 处理

- 平台原始 ID 必须通过 `this.createId(rawId)` 归一化；取字符串形式用 `.string`（如 `params.user_id.string`）。
- 出站方向用 `resolveId` 还原平台 ID。

### 日志

- 运行时必须用 `this.logger.xxx()`（经 `this.app.getLogger(platform)` 获取），**禁止 `console.log`**（eslint `no-console` 告警）。
- 仅初始化阶段可用 `console.log`，统一前缀 `[onebots]`；适配器日志前缀 `[onebots:<platform>]`。
- 日志级别：`trace/debug/info/warn/error/fatal/mark`。

### 错误处理

- catch 变量统一命名 `error`（禁止 `e`/`err`）。
- catch 块至少要记一条 `error` 级日志，不得静默吞异常；确需空 catch 必须注释说明原因。
- 优先使用 `@onebots/core` 的错误体系（`NetworkError`、`ConfigError`、`ValidationError`、`ProtocolError`、`AdapterError` 等），未知错误用 `ErrorHandler.wrap()` 包装。

### 其他

- 单文件不超过 **500 行**，接近时拆分模块；用节标题注释分隔逻辑块。
- **HTTP 请求使用原生 `fetch` 或 `http/https`，禁止使用 axios**；代理用 `https-proxy-agent` / `socks-proxy-agent`。
- 不硬编码配置值；面向用户的错误/日志消息用中文。
- Prettier：4 空格缩进、`semi: true`、`printWidth: 100`、`arrowParens: "avoid"`、括号不换行（`bracketSameLine`）；Markdown 例外（2 空格、不换行宽）。

### Git 提交规范

```
feat: 新功能
fix: Bug 修复
docs: 文档更新
refactor: 重构
test: 测试相关
chore: 构建/工具
```

---

## 扩展开发模式

**新增适配器**（参考现有 `adapters/*`，最简单的样板是 `adapter-mock`）：

1. 继承 `Adapter<TBot, 'platform'>` 基类，构造时 `super(app, 'platform')`。
2. 实现 `createAccount(config)`：构造 bot 与 `Account`，监听 bot 生命周期事件更新 `account.status`。
3. 按需重写 API 方法（如 `sendMessage`），未实现的方法应抛 `${platform} adapter: xxx not implemented`。
4. `AdapterRegistry.register('platform', XxxAdapter, {...})` 注册。
5. 通过 `declare module 'onebots'` 扩展 `Adapter.Configs` 类型。

**新增协议**：实现 `Protocol` 接口并注册到 `ProtocolRegistry`，参考 `protocols/*/` 下现有实现。

**发版约定**：任何对用户可见的改动都应 `pnpm changeset` 添加变更集；保持向后兼容。

---

## 发版与部署

- **CI / 发版**：`.github/workflows/release.yml` — push 到 `master` 触发；流程为 install → build → test → changesets 版本 PR / npm 发布（npm OIDC 可信发布，无需 NPM_TOKEN）。
- **Docker**：`.github/workflows/docker.yml` + 根目录多阶段 `Dockerfile`（node:24-alpine，corepack pnpm@9.15.9；构建时跳过 docs，`.dockerignore` 已排除 adapter-icqq）。镜像发布到 `ghcr.io/lc-cn/onebots`。
  - 运行：`docker run -d -p 6727:6727 -v $(pwd)/data:/data ghcr.io/lc-cn/onebots:master` —— **必须挂载 `/data`**，否则重启丢配置。
  - 另有 `Dockerfile.hf`（Hugging Face Spaces）与 `docker-compose.yml`、`deploy/1panel/`。
- **文档**：`pnpm docs:build`（VitePress），线上为 <https://onebots.pages.dev>（Cloudflare Pages）。
- **CLI 服务化**：`onebots install/start/status/logs` 可安装用户级守护服务，加 `--system` 为系统级服务；`doctor` 诊断环境，`update` 更新主程序与插件。

---

## 安全注意事项

- **永远不要把含真实凭据的 `config.yaml`、token、密钥提交进仓库**；`data/` 是本地运行时目录。配置中的 `access_token` 用于协议层鉴权，Web 管理端有 basic-auth（`koa-basic-auth`）。
- `@onebots/core` 自带安全相关中间件（`packages/core/src/middleware/`：`token-manager`、`token-validator`、`rate-limit`、`security-audit`）——改动鉴权/限流逻辑时务必同步更新 `__tests__/` 中对应的鉴权与心跳测试。
- 安装 `@icqqjs/*` 依赖需要 GitHub Packages token（见 `.npmrc` 与 release workflow 注释）；Docker 构建已通过 `.dockerignore` 排除 adapter-icqq 以规避。
- 处理外部 SDK 数据时使用 `unknown` + 类型守卫，不做强制断言；不信任入站报文字段。
- 使用 `pnpm install --frozen-lockfile` 进行可复现安装（本地/CI）；不要为图方便引入新依赖——先确认 monorepo 内是否已有等价能力。
