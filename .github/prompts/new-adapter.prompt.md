# 创建新适配器

你正在为 OneBots 框架创建一个新的平台适配器。

## 输入

- 平台名称: {{PLATFORM_NAME}}
- 平台显示名: {{PLATFORM_DISPLAY_NAME}}
- 平台 API 文档: {{API_DOCS_URL}}

## 任务

1. 在 `adapters/adapter-{{PLATFORM_NAME}}/` 创建以下文件:
   - `package.json` - 包配置
   - `tsconfig.json` - TypeScript 配置
   - `src/types.ts` - 类型定义
   - `src/bot.ts` - Bot 实现
   - `src/adapter.ts` - 适配器实现
   - `src/index.ts` - 导出入口
   - `README.md` - 文档

2. 适配器必须:
   - 继承 `Adapter` 基类
   - 实现 `createAccount` 方法
   - 注册到 `AdapterRegistry`
   - 支持代理配置（如果需要访问外网）

3. Bot 必须:
   - 继承 `EventEmitter`
   - 发射 `ready`, `message`, `error` 等事件
   - 提供 API 方法

## 模板

```typescript
// src/adapter.ts
import { Adapter, AdapterRegistry, Account, AccountStatus, BaseApp } from 'onebots';
import { {{PLATFORM_NAME}}Bot } from './bot.js';
import type { {{PLATFORM_NAME}}Config } from './types.js';

export class {{PLATFORM_NAME}}Adapter extends Adapter<{{PLATFORM_NAME}}Bot, '{{PLATFORM_NAME}}'> {
    constructor(app: BaseApp) {
        super(app, '{{PLATFORM_NAME}}');
        this.icon = '{{ICON_URL}}';
    }

    createAccount(config: Account.Config<'{{PLATFORM_NAME}}'>): Account<'{{PLATFORM_NAME}}', {{PLATFORM_NAME}}Bot> {
        const bot = new {{PLATFORM_NAME}}Bot(config);
        const account = new Account(this, bot, config);

        bot.on('ready', (user) => {
            this.logger.info(`{{PLATFORM_DISPLAY_NAME}} Bot ${user.name} 已就绪`);
            account.status = AccountStatus.Online;
        });

        bot.on('error', (error) => {
            this.logger.error(`{{PLATFORM_DISPLAY_NAME}} Bot 错误:`, error);
            account.status = AccountStatus.OffLine;
        });

        account.on('start', () => bot.start());
        account.on('stop', () => bot.stop());

        return account;
    }
}

declare module 'onebots' {
    export namespace Adapter {
        export interface Configs {
            {{PLATFORM_NAME}}: {{PLATFORM_NAME}}Config;
        }
    }
}

AdapterRegistry.register('{{PLATFORM_NAME}}', {{PLATFORM_NAME}}Adapter, {
    name: '{{PLATFORM_NAME}}',
    displayName: '{{PLATFORM_DISPLAY_NAME}}',
    description: '{{PLATFORM_DISPLAY_NAME}} 机器人适配器',
    icon: '{{ICON_URL}}',
    author: '凉菜',
});
```

## 检查清单

- [ ] package.json 包含正确的依赖
- [ ] tsconfig.json 继承根配置
- [ ] 类型定义完整
- [ ] 适配器正确注册
- [ ] README 文档完整
- [ ] 添加到 changeset

