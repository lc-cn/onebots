# 添加新 API

你正在为 OneBots 适配器添加新的 API 方法。

## API 设计原则

1. **统一接口**: 所有适配器使用相同的方法签名
2. **类型安全**: 使用 `CommonTypes.Id` 作为 ID 类型
3. **错误处理**: 未实现的方法抛出 "not implemented" 错误
4. **异步操作**: 所有 API 方法返回 Promise

## 步骤

### 1. 在 Adapter 基类定义方法

```typescript
// packages/core/src/adapter.ts

/**
 * 方法描述
 * OneBot V11: xxx
 * OneBot V12: xxx
 * Milky V1: xxx
 * Satori: xxx
 */
methodName(uin: string, params: Adapter.MethodParams): Promise<Adapter.MethodResult> {
    throw new Error(`${this.platform} adapter: methodName not implemented`);
}
```

### 2. 定义参数和返回类型

```typescript
// packages/core/src/adapter.ts - Adapter namespace

export interface MethodParams {
    param1: CommonTypes.Id;
    param2?: string;
}

export interface MethodResult {
    success: boolean;
    data?: any;
}
```

### 3. 在各适配器中实现

```typescript
// adapters/adapter-xxx/src/adapter.ts

async methodName(uin: string, params: Adapter.MethodParams): Promise<Adapter.MethodResult> {
    const account = this.getAccount(uin);
    if (!account) throw new Error(`Account ${uin} not found`);

    const bot = account.client;
    const result = await bot.platformMethod(params.param1.string);

    return {
        success: true,
        data: result,
    };
}
```

### 4. 在协议中映射

```typescript
// protocols/onebot-v11/protocol/src/index.ts

case 'method_name': {
    const result = await adapter.methodName(uin, {
        param1: this.adapter.createId(params.param1),
    });
    return this.success(result);
}
```

## API 命名规范

| 操作 | 前缀 | 示例 |
|------|------|------|
| 获取 | get | `getLoginInfo`, `getUserInfo` |
| 设置 | set | `setGroupCard`, `setFriendRemark` |
| 发送 | send | `sendMessage`, `sendGroupMessage` |
| 删除 | delete | `deleteMessage`, `deleteFriend` |
| 处理 | handle | `handleFriendRequest` |

## 检查清单

- [ ] Adapter 基类已定义方法
- [ ] 参数和返回类型已定义
- [ ] 相关适配器已实现
- [ ] 协议层已映射
- [ ] 测试已添加
- [ ] 文档已更新

