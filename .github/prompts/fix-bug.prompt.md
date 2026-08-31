# 修复 Bug

你正在修复 OneBots 框架中的一个 bug。

## 调试步骤

1. **理解问题**
   - 复现步骤是什么？
   - 预期行为是什么？
   - 实际行为是什么？
   - 错误信息是什么？

2. **定位问题**
   - 检查相关适配器代码 (`adapters/`)
   - 检查核心包代码 (`packages/core/`)
   - 检查协议实现 (`protocols/`)
   - 查看测试用例 (`__tests__/`)

3. **修复问题**
   - 最小化更改
   - 保持向后兼容
   - 添加或更新测试

4. **验证修复**
   ```bash
   pnpm build
   pnpm test
   ```

## 常见问题

### ESM 导入问题
```typescript
// ✅ 正确 - 必须包含 .js 后缀
import { Adapter } from './adapter.js';

// ❌ 错误
import { Adapter } from './adapter';
```

### 类型错误
```typescript
// 使用 type 关键字导入类型
import type { CommonTypes } from './types.js';
```

### 代理问题
```typescript
// Discord/Telegram 代理配置
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
```

### 异步错误处理
```typescript
try {
    await someAsyncOperation();
} catch (error) {
    this.logger.error('操作失败:', error);
    throw error;
}
```

## 提交规范

- `fix: 修复xxx问题`
- `fix(adapter-xxx): 修复xxx适配器的xxx问题`

