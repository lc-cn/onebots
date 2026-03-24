# OneBots 项目 Copilot 指南

## 项目概述

OneBots 是一个使用 TypeScript 实现的多平台多协议机器人应用框架，支持 QQ、ICQQ、微信、钉钉、飞书、企业微信、Telegram、Slack、Discord、Kook、Microsoft Teams、Line 等 12+ 平台。

## 技术栈

- **语言**: TypeScript (ESM)
- **运行时**: Node.js ≥24（`package.json#engines`；`.node-version` 为推荐版本）
- **包管理**: pnpm (workspace monorepo)
- **构建**: tsc + tsc-alias
- **测试**: Vitest
- **文档**: VitePress
- **版本管理**: Changesets

## 项目结构

```
onebots/
├── packages/                    # 核心包
│   ├── core/                   # @onebots/core - 核心抽象层
│   ├── onebots/                # onebots - 主应用包
│   ├── web/                    # @onebots/web - Web 管理界面
│   └── imhelper/               # imhelper - 客户端SDK核心
├── adapters/                    # 平台适配器
│   ├── adapter-qq/             # QQ官方机器人
│   ├── adapter-icqq/           # ICQQ协议
│   ├── adapter-discord/        # Discord (轻量级实现)
│   ├── adapter-telegram/       # Telegram (grammy)
│   ├── adapter-feishu/         # 飞书/Lark
│   ├── adapter-dingtalk/       # 钉钉
│   ├── adapter-kook/           # Kook
│   ├── adapter-slack/          # Slack
│   ├── adapter-wecom/          # 企业微信
│   ├── adapter-wechat/         # 微信公众号
│   ├── adapter-teams/          # Microsoft Teams
│   ├── adapter-line/           # Line
│   └── adapter-mock/           # Mock (测试用)
├── protocols/                   # 协议实现
│   ├── milky-v1/               # Milky协议
│   ├── onebot-v11/             # OneBot v11
│   ├── onebot-v12/             # OneBot v12
│   └── satori-v1/              # Satori协议
├── docs/                        # VitePress 文档
├── __tests__/                   # 测试文件
└── development/                 # 开发环境配置
```

## 编码规范

### TypeScript

- 使用 ESM 模块 (`type: "module"`)
- 导入路径必须包含 `.js` 后缀
- 启用 strict 模式
- 使用 `type` 关键字导入类型

```typescript
// ✅ 正确
import { Adapter } from './adapter.js';
import type { CommonTypes } from './types.js';

// ❌ 错误
import { Adapter } from './adapter';
```

### 适配器开发

1. 继承 `Adapter` 基类
2. 实现 `createAccount` 方法
3. 重写需要支持的 API 方法
4. 注册到 `AdapterRegistry`

```typescript
import { Adapter, AdapterRegistry, Account, AccountStatus } from 'onebots';

export class MyAdapter extends Adapter<MyBot, 'my_platform'> {
    constructor(app: BaseApp) {
        super(app, 'my_platform');
        this.icon = 'https://example.com/icon.png';
    }

    createAccount(config: Account.Config<'my_platform'>): Account<'my_platform', MyBot> {
        const bot = new MyBot(config);
        const account = new Account(this, bot, config);
        
        bot.on('ready', () => {
            account.status = AccountStatus.Online;
        });
        
        return account;
    }
}

AdapterRegistry.register('my_platform', MyAdapter, {
    name: 'my_platform',
    displayName: 'My Platform',
    description: '...',
});
```

### 协议开发

1. 继承 `Protocol` 基类
2. 实现 HTTP 和 WebSocket 处理
3. 注册到 `ProtocolRegistry`

## 常用命令

```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 运行测试
pnpm test

# 构建文档
pnpm docs:build

# 开发模式
pnpm dev

# 添加 changeset
pnpm changeset
```

## 测试

- 单元测试使用 Mock 适配器 (`@onebots/adapter-mock`)
- 集成测试需要真实服务器
- 测试文件放在 `__tests__/` 目录

```typescript
import { MockBot } from '@onebots/adapter-mock';

const bot = new MockBot({
    account_id: 'test',
    latency: 0,
});
await bot.start();

// 测试 API
const info = await bot.getLoginInfo();

// 手动触发事件
bot.triggerEvent('message', { ... });
```

## 代理配置

Discord 和 Telegram 支持代理：

```yaml
discord.my_bot:
  token: 'xxx'
  proxy:
    url: 'socks5://127.0.0.1:7890'

telegram.my_bot:
  token: 'xxx'
  proxy:
    url: 'http://127.0.0.1:7890'
```

## 私有包

`@icqqjs/icqq` 是私有 GitHub Package，需要配置：

```bash
# .npmrc
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
@icqqjs:registry=https://npm.pkg.github.com
```

## 发布流程

1. 创建 changeset: `pnpm changeset`
2. 推送到 master 分支
3. Version PR 自动创建
4. 合并 PR 后自动发布到 npm

## 重要文件

- `packages/core/src/adapter.ts` - 适配器基类 (72 个 API 方法)
- `packages/core/src/protocol.ts` - 协议基类
- `packages/core/src/types.ts` - 通用类型定义
- `packages/core/src/retry.ts` - 重试机制
- `packages/core/src/rate-limiter.ts` - 速率限制

## 注意事项

1. 新增适配器需要添加到 changeset
2. 使用 `fetch` 而非 `axios`（ESM 兼容）
3. Node.js 环境下需要代理时使用 `https-proxy-agent`
4. WebSocket 代理使用 `socks-proxy-agent`
5. 所有 API 方法返回统一的 `CommonTypes` 格式

