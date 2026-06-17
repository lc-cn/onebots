# OneBots 贡献指南

感谢你关注 OneBots 项目！本文档涵盖开发环境搭建、代码规范、测试要求以及提交流程。

---

## 目录

- [开发环境](#开发环境)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [代码规范](#代码规范)
  - [类型规范](#类型规范)
  - [日志规范](#日志规范)
  - [错误处理规范](#错误处理规范)
  - [文件大小规范](#文件大小规范)
  - [导入规范](#导入规范)
  - [注释规范](#注释规范)
- [测试规范](#测试规范)
- [Git 提交规范](#git-提交规范)
- [PR 流程](#pr-流程)
- [构建和脚本](#构建和脚本)
- [添加适配器](#添加适配器)
- [添加协议](#添加协议)

---

## 开发环境

| 工具 | 最低版本 | 推荐版本 |
|------|---------|---------|
| Node.js | **>= 24** | 与 `.node-version` 保持一致 |
| pnpm | **>= 9.12.0** | **9.15.9**（项目锁定版本） |
| TypeScript | 5.x | 5.x（参见 `catalog:`） |

Node.js 版本要求见 `package.json#engines`，推荐本地开发版本见 `.node-version` / `.nvmrc`，可使用 `fnm use` / `nvm use` 切换。

---

## 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/lc-cn/onebots.git
cd onebots

# 2. 安装依赖
pnpm install

# 3. 构建核心包（首次必须执行）
pnpm build:packages

# 4. 全量构建
pnpm build

# 5. 启动开发环境
pnpm dev

# 6. 运行测试
pnpm test
```

> **注意**：首次 clone 后必须执行 `pnpm build:packages`，因为 `packages/*` 之间有内部依赖关系，需要先生成 `lib/` 输出。

**可选命令：**

```bash
pnpm docs:dev         # 启动文档站点（VitePress，端口 8989）
pnpm web:dev          # 启动 Web 管理端前端
pnpm test:watch       # 监听模式运行测试
pnpm test:coverage    # 生成测试覆盖率报告
pnpm lint             # Prettier 格式检查
pnpm lint:fix         # 自动修复格式
```

---

## 项目结构

```
onebots/
├── packages/                     # 核心包（@onebots/*）
│   ├── core/                     #   @onebots/core — 核心抽象层
│   │   ├── src/                  #     适配器/协议基类、账号、ID 映射、路由、日志、错误、配置
│   │   └── src/__tests__/        #     核心层单元测试
│   ├── onebots/                  #   onebots — 网关主程序、CLI、App
│   │   ├── src/                  #     App（继承 BaseApp）、路由模块、CLI bin
│   │   └── src/routes/           #     auth / config / adapter-api / verification / terminal / public-static
│   ├── imhelper/                 #   @onebots/imhelper — 客户端 SDK 核心
│   └── web/                      #   @onebots/web — Web 管理端界面
├── adapters/                     # 平台适配器（@onebots/adapter-*，共 18 个）
│   ├── adapter-mock/             #   模拟适配器（测试用）
│   ├── adapter-qq/               #   QQ 官方机器人适配器
│   ├── adapter-icqq/             #   ICQQ 适配器
│   ├── adapter-wechat/           #   微信公众号适配器
│   ├── adapter-wecom/            #   企业微信适配器
│   ├── adapter-wecom-kf/         #   企业微信客服适配器
│   ├── adapter-wechat-clawbot/   #   微信个人号适配器
│   ├── adapter-dingtalk/         #   钉钉适配器
│   ├── adapter-feishu/           #   飞书适配器
│   ├── adapter-slack/            #   Slack 适配器
│   ├── adapter-discord/          #   Discord 适配器
│   ├── adapter-telegram/         #   Telegram 适配器
│   ├── adapter-kook/             #   Kook 适配器
│   ├── adapter-teams/            #   Microsoft Teams 适配器
│   ├── adapter-line/             #   LINE 适配器
│   ├── adapter-email/            #   邮件适配器
│   ├── adapter-whatsapp/         #   WhatsApp 适配器
│   └── adapter-zulip/            #   Zulip 适配器
├── protocols/                    # 对外协议（@onebots/protocol-* + @imhelper/* SDK）
│   ├── onebot-v11/               #   OneBot v11 协议
│   ├── onebot-v12/               #   OneBot v12 协议
│   ├── satori-v1/                #   Satori v1 协议
│   └── milky-v1/                 #   Milky v1 协议
├── docs/                         # VitePress 文档站点
├── __tests__/                    # 集成/端到端测试
└── development/                  # 开发环境配置（Docker Compose 等）
```

**命名约定：**

| 类型 | 包名 | 示例 |
|------|------|------|
| 核心包 | `@onebots/*` | `@onebots/core`、`@onebots/web` |
| 主应用 | `onebots` | `onebots` |
| 适配器 | `@onebots/adapter-*` | `@onebots/adapter-qq` |
| 协议 | `@onebots/protocol-*` | `@onebots/protocol-onebot-v11` |
| 客户端 SDK | `imhelper` / `@imhelper/*` | `@imhelper/onebot-v11` |

---

## 代码规范

### 类型规范

- **禁止使用 `any`**。标记为 `@ts-ignore` / `@ts-expect-error` 的除外，且必须附注释说明原因。
- **外部 SDK 返回值**使用 `unknown` + 类型守卫（type guard），不做强制断言。
- **优先使用 `interface`** 而非 `type` 来定义对象类型。`type` 仅用于联合类型、交叉类型、工具类型等非对象场景。
- **PascalCase**：类名、接口名、枚举名、类型名。
- **camelCase**：变量名、函数名、方法名、属性名。
- **namespace 组织**：相关的类型定义应放在对应的 namespace 下（如 `Adapter.SendMessageParams`、`CommonTypes.Scene`）。

**示例：**

```typescript
// 正确：使用 interface 定义对象类型
export interface UserInfo {
    user_id: CommonTypes.Id;
    user_name: string;
    avatar?: string;
}

// 正确：使用 type 定义联合类型
export type Scene = "private" | "group" | "channel" | "direct";

// 正确：外部 SDK 返回值使用 unknown + 类型守卫
function handleSdkResult(value: unknown): string {
    if (typeof value === 'object' && value !== null && 'id' in value) {
        return String(value.id);
    }
    throw new Error('Invalid SDK result');
}

// 正确：namespace 组织类型
export namespace Adapter {
    export interface SendMessageParams {
        scene_type: CommonTypes.Scene;
        scene_id: CommonTypes.Id;
        message: CommonTypes.Segment[];
    }
}

// 错误：使用 any
const data: any = await api.call(); // 禁止
```

### 日志规范

- **运行时日志必须使用 `this.logger.xxx()`**，通过 `this.app.getLogger(platform)` 或 `this.app.getEnhancedLogger(name)` 获取 Logger 实例。
- **禁止在运行时使用 `console.log` / `console.error`**。
- **初始化阶段**（logger 尚未就绪）可以使用 `console.log`，前缀统一为 `[onebots]`。
- **日志前缀格式**：
  - 应用日志：`[onebots]`
  - 平台适配器日志：`[onebots:<platform>]`（如 `[onebots:mock]`）
  - 账号日志：以 `account_id` 为名
  - 协议日志：`<name>/<version>`（通过 `this.app.getLogger(\`${this.name}/${this.version}\`)`）
- **日志级别**：`trace` / `debug` / `info` / `warn` / `error` / `fatal` / `mark`。
- 可使用 `this.enhancedLogger.start(operation)` 获取计时器，调用返回的函数结束计时并自动记录耗时。
- 性能指标记入 info 级别，附带 `type: 'performance'` 上下文。

**示例：**

```typescript
// 正确：运行时日志
this.logger.info(`Starting adapter for platform ${this.platform}`);

// 正确：增强日志计时
const stopTimer = this.enhancedLogger.start('Application start');
// ... 执行操作 ...
stopTimer();

// 正确：初始化阶段
console.log('[onebots] 使用 Web 前端目录:', dir);

// 错误：运行时使用 console
console.log('send message success'); // 禁止
```

### 错误处理规范

- **catch 块变量统一命名为 `error`**，禁止使用 `e` / `err` / `ex`。
- **运行时 catch 块必须至少记录 `error` 级别日志**，不能静默吞掉异常。
- **空 catch 块必须有注释**说明可忽略原因。
- 优先使用 OneBotsError 体系中的具体错误类型，而非泛化 `Error`：

| 错误类型 | 类别 | 严重度 |
|---------|------|--------|
| `NetworkError` | NETWORK | MEDIUM |
| `ConfigError` | CONFIG | HIGH |
| `ValidationError` | VALIDATION | MEDIUM |
| `ResourceError` | RESOURCE | HIGH |
| `ProtocolError` | PROTOCOL | MEDIUM |
| `AdapterError` | ADAPTER | HIGH |
| `RuntimeError` | RUNTIME | HIGH |

- 使用 `ErrorHandler.wrap(error)` 将未知错误包装为 `OneBotsError`，而非直接抛出原始 Error。

**示例：**

```typescript
// 正确：统一命名 + 日志记录
try {
    await adapter.start();
} catch (error) {
    const wrappedError = ErrorHandler.wrap(error, { platform });
    this.enhancedLogger.error(wrappedError, { platform });
}

// 正确：空 catch 有注释
try {
    // 执行可忽略的清理操作
} catch (error) {
    // 清理失败不影响主流程，忽略
}

// 正确：使用具体错误类型
throw new NetworkError('Connection timeout', {
    context: { host, port },
    cause: originalError,
});

// 错误：使用简短变量名 + 无日志
catch (e) { /* empty */ } // 禁止
```

### 文件大小规范

- **单文件不超过 500 行**。
- **API 方法定义**如果只抛一个异常，可以采用单行 throw 语句压缩：

```typescript
// 正确：单行 throw
sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
    throw new Error(`${this.platform} adapter: sendMessage not implemented`);
}
```

- 如果文件接近 500 行，考虑拆分为多个模块。
- 节标题注释分隔不同逻辑块，提升可读性：

```typescript
// ============================================
// 消息相关方法 (Message - 7个)
// ============================================
```

### 导入规范

- 使用 ES Module（`type: "module"`），**相对路径导入必须包含 `.js` 扩展名**。
- 别名路径使用 `@/` 前缀（映射到 `packages/core/src`）。
- 避免循环依赖。如发现循环引用，考虑提取公共类型到独立的 `types.ts`。

```typescript
// 正确：相对路径导入
import { Account } from "@/account.js";
import { Router } from "./router.js";

// 正确：第三方包直接引用
import { describe, it, expect } from 'vitest';
import { EventEmitter } from "events";

// 正确：JSON 导入
import pkg from "../package.json" with { type: "json" };

// 错误：缺少 .js 扩展名
import { Account } from "../account"; // 在 ESM 下错误
```

### 注释规范

- **JSDoc 风格**：公开 API 和方法应有 JSDoc 注释，描述参数、返回值和用途。
- **中文注释**：文件头说明、章节分隔、逻辑说明使用中文。
- **英文注释**：技术术语（类型名、函数签名引用）保持英文。
- **分隔注释**：方法分组使用 `// =====` 标题块。
- **TODO/FIXME**：标注待办事项时注明作者和日期。

```typescript
/**
 * 发送消息
 * @param uin 账号标识
 * @param params 发送参数
 * @returns 消息 ID
 */
sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult>;

// TODO: 添加重试逻辑 - @author, 2026-06
```

---

## 测试规范

- **测试框架**：使用 [vitest](https://vitest.dev/)（v1.6.x）。
- **测试文件命名**：`*.test.ts`（被 `vitest.config.ts` 的 `include` 配置覆盖）。
- **测试结构**：`describe` / `it` / `expect` 风格（全局 API 已启用）。
- **覆盖率目标**：lines >= 50%，functions >= 50%，branches >= 40%，statements >= 50%。
- **每个适配器必须有基础测试**，覆盖：
  - 生命周期（createAccount -> start -> stop，状态转换 Pending -> Online -> Offline）
  - 消息发送（至少一个正向用例，验证 message_id 往返）
  - ID 管理（createId / resolveId 往返，缓存命中，异常输入）
- **测试不依赖外部服务**。外部依赖需通过 mock / stub 替换。
- **Mock 框架依赖**：使用 `vi.mock()` 模拟 Node 内置模块或第三方 SDK（参考 `adapters/adapter-mock/src/__tests__/adapter.test.ts`）。
- **内联 Mock 实现**：对于数据库等基础设施，提供最小化内存 Mock 替代。

**示例**（测试文件头部注释模板）：

```typescript
/**
 * <Module> 单元测试
 *
 * 覆盖场景：
 * 1. 生命周期：...
 * 2. ...
 */
```

**运行测试：**

```bash
pnpm test              # 运行所有测试
pnpm test:watch        # 监听模式
pnpm test:ui           # 浏览器 UI 模式
pnpm test:coverage     # 覆盖率报告
```

---

## Git 提交规范

使用 **Conventional Commits** 格式：

```
type(scope): message
```

**type 取值：**

| type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复问题 |
| `refactor` | 重构（不改变外部行为） |
| `chore` | 构建/工具/依赖相关 |
| `test` | 测试相关 |
| `docs` | 文档相关 |
| `perf` | 性能优化 |
| `style` | 代码格式（不影响逻辑） |

**scope 取值：**

- `core` — 核心抽象层
- `onebots` — 主应用/CLI
- `adapter-<platform>` — 某平台适配器（如 `adapter-qq`、`adapter-icqq`）
- `protocol-<name>` — 某协议（如 `protocol-onebot-v11`）
- `web` — 管理端
- `imhelper` — 客户端 SDK
- `docs` — 文档

**提交示例：**

```
feat(core): add rate limiter middleware
fix(adapter-qq): handle empty message list in getGroupMessages
refactor(onebots): split app.ts into route modules
test(adapter-mock): add lifecycle and message tests
chore: upgrade pnpm to 9.15.9
docs: update architecture overview
```

**提交署名：**

每个 commit 应包含 Co-Authored-By 署名：

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## PR 流程

1. **分支**：从 `master` 创建功能分支：

   ```bash
   git checkout master
   git pull
   git checkout -b feat/<简短描述>
   ```

   分支命名参考：`feat/adapter-xxx`、`fix/xxx-bug`、`refactor/xxx`。

2. **开发**：在分支上完成代码修改，确保通过 `pnpm lint` 和 `pnpm test`。

3. **变更集**：如果涉及包版本变更（新功能或修复），使用 `pnpm changeset` 生成变更集（选择变动的包和版本类型）。

4. **提交**：提交到分支后，在 GitHub 创建 Pull Request 到 `master`：

   - 标题清晰描述变更
   - 正文说明背景、改动和测试情况
   - 关联相关 issue（如有）

5. **CI**：合并前 CI（GitHub Actions）必须全部通过。

6. **合并**：使用 **Squash Merge**，合并后删除分支。

**发布流程（维护者）：**

```bash
pnpm changeset              # 选择变更的包和版本类型（patch/minor/major）
pnpm changeset:version      # 应用版本更新
pnpm changeset:publish      # 发布到 npm
```

---

## 构建和脚本

| 命令 | 说明 |
|------|------|
| `pnpm build:packages` | 构建 `packages/*`（core / onebots / web / imhelper），串行执行 |
| `pnpm build:rest` | 构建 adapters / protocols / docs |
| `pnpm build` | `build:packages` + `build:rest` |
| `pnpm clean` | 清理所有包的构建产物 |
| `pnpm dev` | 启动开发环境（onebots-dev 的调试网关） |
| `pnpm lint` | Prettier 格式检查 |
| `pnpm lint:fix` | Prettier 自动修复格式 |
| `pnpm test` | 运行所有测试（vitest run --passWithNoTests） |
| `pnpm test:watch` | vitest 监听模式 |
| `pnpm test:ui` | vitest UI 模式 |
| `pnpm test:coverage` | 带覆盖率报告的测试 |
| `pnpm changeset` | 创建变更集（发版用） |
| `pnpm changeset:version` | 应用变更集版本 |
| `pnpm changeset:publish` | 发布到 npm |

---

## 添加适配器

添加新平台适配器（以 `adapter-foo` 为例）：

### 1. 创建包结构

在 `adapters/` 下创建 `adapter-foo/`，包含：

```
adapter-foo/
├── package.json            # name: "@onebots/adapter-foo"
├── tsconfig.json
└── src/
    ├── index.ts            # 入口：导出 + 注册
    ├── adapter.ts          # Adapter 子类实现
    ├── bot.ts              # 平台客户端封装
    └── types.ts            # 配置类型定义
```

### 2. 实现 Adapter

继承 `Adapter` 抽象类，实现平台支持的 API 方法：

```typescript
import { Account, AdapterRegistry, AccountStatus, BaseApp, Adapter, CommonTypes } from "onebots";

export class FooAdapter extends Adapter<FooBot, "foo"> {
    constructor(app: BaseApp) {
        super(app, "foo");
        this.icon = "https://...";
    }

    // 实现需要用到的 API 方法（其他方法继承基类的 throw 未实现）
    async sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        // ...
    }

    createAccount(config: Account.Config<"foo">): Account<"foo", FooBot> {
        // 创建 Bot 实例，返回 Account
    }
}
```

### 3. 注册配置类型

在 `adapter.ts` 底部或 `types.ts` 中扩展 `Adapter.Configs`：

```typescript
declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            foo: FooConfig;
        }
    }
}
```

### 4. 注册适配器到 Registry

在 `index.ts` 中：

```typescript
import { AdapterRegistry } from 'onebots';

AdapterRegistry.register('foo', FooAdapter, {
    name: 'foo',
    displayName: 'Foo 适配器',
    description: '描述文字',
    icon: '...',
    homepage: '...',
    author: '...',
});

AdapterRegistry.registerSchema('foo', { ... });
```

### 5. 添加测试

在 `src/__tests__/adapter.test.ts` 中编写基础测试，覆盖生命周期、消息发送、ID 管理。

**参考实现**：`adapters/adapter-mock/` 是一个完整的最小工作参考示例，包含所有标准模式。

---

## 添加协议

添加新协议（以 `protocol-bar` 为例）：

### 1. 创建包结构

在 `protocols/` 下创建目录（如 `bar-v1/`），包含服务端实现和可选的客户端 SDK。

### 2. 实现 Protocol

继承 `Protocol` 抽象类：

```typescript
import { Protocol, Adapter, Account } from "onebots";

export class BarProtocol extends Protocol<"v1"> {
    public readonly name = "bar";
    public readonly version = "v1" as const;

    async start(): Promise<void> {
        // 注册 HTTP/WS 路由
    }

    async stop(force?: boolean): Promise<void> {
        // 清理资源
    }

    async dispatch(event: any): Promise<void> {
        // 将 CommonEvent 转为协议格式并发送
    }

    format(event: string, payload: any): any {
        // 按协议规范格式化数据
    }

    async apply(action: string, params?: any): Promise<any> {
        // 处理入站 API 调用
    }
}
```

### 3. 注册协议

```typescript
ProtocolRegistry.register('bar', 'v1', BarProtocol, {
    name: 'bar',
    displayName: 'Bar Protocol',
    description: '...',
    versions: ['v1'],
});
```

### 4. 添加测试

**参考实现**：`protocols/onebot-v11/` 是一个完整的参考示例。

---

## 问题和联系

- **Issues**：https://github.com/lc-cn/onebots/issues
- **QQ 群**：860669870
- **在线文档**：https://onebots.pages.dev

---

## 许可证

通过提交 PR，你同意你的贡献将在 MIT 许可证下发布。
