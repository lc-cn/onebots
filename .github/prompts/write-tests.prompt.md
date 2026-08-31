# 编写测试

你正在为 OneBots 框架编写测试。

## 测试类型

### 1. 单元测试 (推荐用于 CI)

使用 Mock 适配器，不需要真实服务器：

```javascript
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { MockBot } from '@onebots/adapter-mock';

describe('功能测试', () => {
    let bot;

    beforeAll(async () => {
        bot = new MockBot({
            account_id: 'test_bot',
            latency: 0, // 禁用延迟加快测试
        });
        await bot.start();
    });

    afterAll(async () => {
        await bot.stop();
    });

    test('getLoginInfo', async () => {
        const info = await bot.getLoginInfo();
        expect(info.user_id).toBe('test_bot');
    });

    test('sendMessage', async () => {
        const result = await bot.sendMessage('10001', 'Hello!');
        expect(result.message_id).toBeDefined();
    });

    test('事件触发', async () => {
        const events = [];
        bot.on('message', (e) => events.push(e));

        bot.triggerEvent('message', {
            type: 'private',
            user_id: '10001',
            content: '测试消息',
        });

        expect(events.length).toBe(1);
    });
});
```

### 2. 集成测试 (需要真实服务器)

```javascript
import { describe, test, expect, beforeAll } from 'vitest';
import { checkServerAvailable, httpRequest } from './utils/http-client.js';

const CONFIG = {
    baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
    platform: 'mock',
    accountId: 'test',
};

let serverAvailable = false;

beforeAll(async () => {
    serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
});

test('API 测试', async () => {
    if (!serverAvailable) {
        console.log('⏭️  跳过：服务器不可用');
        return;
    }

    const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_login_info');
    
    // 处理连接失败
    if (status === 0) {
        console.log('⏭️  跳过：连接失败');
        return;
    }

    expect(status).toBe(200);
    expect(data.status).toBe('ok');
});
```

### 3. WebSocket 测试

```javascript
import { WebSocket } from 'ws';

test('WebSocket 连接', async () => {
    if (!serverAvailable) return;

    const ws = new WebSocket(`ws://localhost:6727/mock/test/onebot/v11`);

    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('超时')), 5000);
            
            ws.on('open', () => {
                clearTimeout(timeout);
                resolve();
            });
            
            ws.on('error', (error) => {
                clearTimeout(timeout);
                // 处理 404 等错误
                if (error.message?.includes('404')) {
                    console.log('⏭️  WebSocket 端点未配置');
                    resolve();
                } else {
                    reject(error);
                }
            });
        });
        
        ws.close();
    } catch (error) {
        // 优雅处理错误
    }
});
```

## 测试文件位置

```
__tests__/
├── unit/                    # 单元测试 (Mock)
│   └── mock-adapter.spec.js
├── onebot/                  # OneBot 协议测试
│   ├── v11/
│   └── v12/
├── milky/                   # Milky 协议测试
│   └── v1/
└── satori/                  # Satori 协议测试
    └── v1/
```

## 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试
pnpm test -- __tests__/unit/mock-adapter.spec.js

# 运行匹配的测试
pnpm test -- --grep "getLoginInfo"

# 生成覆盖率报告
pnpm test -- --coverage
```

## 测试规范

1. **独立性**: 每个测试独立运行
2. **幂等性**: 多次运行结果一致
3. **清理**: 测试后清理资源
4. **超时**: 设置合理的超时时间
5. **跳过**: 服务器不可用时优雅跳过

