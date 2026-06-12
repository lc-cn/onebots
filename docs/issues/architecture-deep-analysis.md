# OneBots 深度架构分析 - Issues 汇总

> 分析时间: 2026-05-22
> 分析范围: 核心架构、适配器、协议、测试、CI/CD

---

## Issue 1: Account.start() 未 await 协议启动，导致未处理的 Promise Rejection

**严重程度**: 🔴 Critical  
**位置**: `packages/core/src/account.ts:77-83`

### 问题描述

`Account.start()` 方法声明为 `async`，但内部循环调用 `protocol.start()` 时未使用 `await`：

```typescript
async start() {
    this.logger.info(`Starting account ${this.account_id}`);
    this.emit("start");
    for (const protocol of this.protocols) {
        protocol.start(); // ← 未 await！
    }
}
```

### 影响

1. 协议启动失败时，错误被静默吞噬（Unhandled Promise Rejection）
2. Account 报告 "started" 状态时，协议可能尚未真正启动
3. Node.js 会因未处理的 Promise Rejection 终止进程
4. 无法感知协议启动的级联失败

### 建议修复

```typescript
async start() {
    this.logger.info(`Starting account ${this.account_id}`);
    this.emit("start");
    for (const protocol of this.protocols) {
        await protocol.start(); // 逐个 await
    }
}
```

---

## Issue 2: removeAccount() 未 await account.stop()，导致资源泄漏

**严重程度**: 🔴 Critical  
**位置**: `packages/core/src/base-app.ts:401-409`

### 问题描述

```typescript
public removeAccount(p: string, uin: string, force?: boolean) {
    const adapter = this.findOrCreateAdapter(p);
    if (!adapter) return;
    const account = adapter.accounts.get(uin);
    if (!account) return this.logger.warn(`未找到账号${uin}`);
    account.stop(force);  // ← 异步方法未 await
    delete this.config[`${p}.${uin}`];
    adapter.accounts.delete(uin);
    writeFileSync(BaseApp.configPath, yaml.dump(this.config));
}
```

### 影响

1. `account.stop()` 是异步方法，但未被 await
2. 配置在协议实际停止前就已保存
3. 协议仍在运行时，Account 引用已被删除
4. WebSocket 连接、定时器等资源可能永远不会释放

### 建议修复

将方法改为 `async`，并 await stop 调用：

```typescript
public async removeAccount(p: string, uin: string, force?: boolean) {
    // ...
    await account.stop(force);
    // ...
}
```

---

## Issue 3: createId() 存在无限递归风险和 ID 碰撞问题

**严重程度**: 🔴 High  
**位置**: `packages/core/src/adapter.ts:55-73`

### 问题描述

```typescript
createId(id: string | number): CommonTypes.Id {
    // ...
    const randomNum = Math.floor(Math.random() * 100000000000); // 11位随机数
    const [checkExist] = this.db.select('*').from(this.tableName).where({
        number: randomNum
    }).run();

    if (checkExist) return this.createId(id); // ← 无限递归风险！
    // ...
}
```

### 问题细节

1. **无限递归**: 当 ID 空间被大量占用时，递归无退出条件，可能导致栈溢出
2. **弱随机数**: `Math.random()` 不是加密安全的随机数生成器
3. **碰撞概率**: 10^11 的空间在大量 ID 下碰撞概率不低（生日悖论）
4. **竞态条件**: 检查和插入之间无事务保护，并发时可能插入相同 number

### 建议修复

```typescript
createId(id: string | number, maxRetries = 10): CommonTypes.Id {
    if (maxRetries <= 0) throw new Error('createId: 超过最大重试次数');
    // 使用 crypto.randomInt 生成更安全的随机数
    const randomNum = crypto.randomInt(Number.MAX_SAFE_INTEGER);
    // ...
    if (checkExist) return this.createId(id, maxRetries - 1);
}
```

---

## Issue 4: EventEmitter 监听器无清理机制，存在内存泄漏

**严重程度**: 🔴 High  
**位置**: `packages/core/src/account.ts`, `packages/core/src/adapter.ts`

### 问题描述

`Account` 和 `Adapter` 类继承 `EventEmitter`，但在生命周期管理中未清理监听器：

- `Account.stop()` 不调用 `this.removeAllListeners()`
- 协议在 Account 上注册的监听器永远不会被移除
- 长期运行的服务中，账号多次 start/stop 后监听器累积

### 影响

1. 内存持续增长（每个监听器引用闭包链）
2. 事件触发时，旧的无效监听器仍被调用
3. Node.js MaxListenersExceeded 警告

### 建议修复

在 `Account.stop()` 中添加清理逻辑：

```typescript
async stop(force?: boolean) {
    for (const protocol of this.protocols) {
        await protocol.stop(force);
    }
    this.removeAllListeners();
    this.emit("stop");
}
```

---

## Issue 5: QQ 适配器 WebSocket 存在多重竞态条件

**严重程度**: 🔴 High  
**位置**: `adapters/adapter-qq/src/bot.ts`

### 问题描述

1. **重连竞态**: `close` 事件和 opcode 7 (RECONNECT) 都会触发重连，可能同时执行
2. **Session ID 清理时序**: `sessionId` 在 RESUME 失败时被清空，但重连逻辑可能已在执行中
3. **多重连接**: 没有防护机制阻止多个并发的 `connect()` 调用
4. **心跳泄漏**: 如果 `stop()` 抛出异常，heartbeat interval 永远不会被清理

```typescript
// bot.ts 中 accessToken 在 stop() 后永不清理
private accessToken: string = '';  // 安全隐患：内存中残留凭证
```

### 建议修复

- 添加连接状态机（Disconnected → Connecting → Connected → Reconnecting）
- 使用互斥锁防止并发重连
- 在 stop() 中清理 accessToken
- 确保 heartbeat 清理在 finally 块中

---

## Issue 6: OneBot V11 协议 messageIdMap 无 TTL，存在内存泄漏

**严重程度**: 🟡 Medium  
**位置**: `protocols/onebot-v11/protocol/src/index.ts:37`

### 问题描述

```typescript
private messageIdMap = new Map<number, string>();
```

每条消息都会向此 Map 写入映射，但只在 `stop()` 时清理。长时间运行的机器人实例中，此 Map 会无限增长。

### 影响

- 每条消息约 88 字节，100万消息 ≈ 88MB
- 高流量群聊中，数小时内可能达到 GB 级别
- 无 LRU 或 TTL 淘汰机制

### 建议修复

使用有大小限制的 Map 或 LRU Cache：

```typescript
private messageIdMap = new LRUCache<number, string>({ max: 10000 });
```

---

## Issue 7: Discord 适配器 WebSocket 连接无超时机制

**严重程度**: 🟡 High  
**位置**: `adapters/adapter-discord/src/`

### 问题描述

Discord Gateway WebSocket 连接建立后：
- 无连接超时检测 - 如果 `open` 事件永不触发，连接会永远挂起
- 重连使用固定 5 秒间隔 - 无指数退避，可能触发 Discord 速率限制
- `cleanup()` 中 `removeAllListeners()` 可能在活跃的事件发送期间调用

### 建议修复

- 添加连接超时（如 30 秒）
- 实现指数退避重连策略
- 在 cleanup 中先关闭 WebSocket 再移除监听器

---

## Issue 8: Telegram 适配器安全隐患 - 代理凭证可能泄露到日志

**严重程度**: 🟡 High  
**位置**: `adapters/adapter-telegram/src/`

### 问题描述

1. 代理 URL（可能包含用户名密码）可能出现在日志输出中
2. `botInited` 标志存在竞态条件 - 并发的 webhook 请求可能导致多次初始化
3. 轮询模式下连接资源未显式清理

### 建议修复

- 日志输出中过滤代理凭证
- 使用 Promise 替代布尔标志实现一次性初始化
- 在 stop() 中显式停止轮询

---

## Issue 9: 测试覆盖率严重不足，CI 可静默放行

**严重程度**: 🔴 Critical  
**位置**: `vitest.config.ts`, `.github/workflows/release.yml`, `package.json`

### 问题描述

1. **26 个适配器/协议完全无单元测试**
2. Vitest 配置 `--passWithNoTests` - 即使无测试也通过
3. CI workflow 中 `continue-on-error: true` - 测试失败不阻断发布
4. 覆盖率阈值仅 50% lines, 40% branches - 且仅覆盖 `packages/*/src/`

### 影响

- 回归 bug 无法被检测
- 发布包可能包含严重 bug
- 无法保证核心 API 的正确性

### 建议修复

1. 移除 `--passWithNoTests`
2. 移除 CI 中的 `continue-on-error: true`
3. 为核心适配器添加基本单元测试
4. 提高覆盖率阈值至 80%+

---

## Issue 10: 依赖版本不一致且使用 "latest" 标签

**严重程度**: 🟡 Medium  
**位置**: 多个 `package.json` 文件

### 问题描述

1. **33 个开发依赖使用 `"latest"` 版本标签**
   - `tsc-alias: "latest"`, `tsx: "latest"`, `tsconfig-paths: "latest"`
   - 不同时间安装可能得到不同版本，破坏构建可重复性

2. **跨包版本不一致**:
   - `eventsource`: imhelper 用 `^4.1.0`, development 用 `^2.0.0`（主版本差异！）
   - `ws`: core 用 `^8.16.0`, imhelper 用 `^8.18.3`

3. **TypeScript 配置不一致**:
   - strict mode: 有的包 true，有的 false
   - moduleResolution: 混用 `bundler`、`node`、`nodenext`

### 建议修复

1. 将所有 `"latest"` 替换为具体版本号
2. 统一跨包依赖版本
3. 统一 TypeScript 配置策略

---

## Issue 11: Rate Limiter 队列请求无超时机制

**严重程度**: 🟡 Medium  
**位置**: `packages/core/src/rate-limiter.ts`

### 问题描述

当速率限制触发时，请求被加入队列等待执行。但队列中的请求没有超时机制：
- 如果队列处理器异常退出，请求永远不会被 resolve 或 reject
- 调用方 Promise 永远处于 pending 状态
- 内存中保持着对请求闭包的引用

### 建议修复

为队列请求添加 TTL：

```typescript
interface QueuedRequest<T> {
    execute: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    enqueueTime: number; // 添加入队时间
}

// 处理队列时检查是否超时
if (Date.now() - request.enqueueTime > this.requestTimeout) {
    request.reject(new Error('Request timeout in rate limiter queue'));
    continue;
}
```

---

## Issue 12: 适配器间缺乏统一的错误边界

**严重程度**: 🔴 High  
**位置**: 所有适配器的事件处理器

### 问题描述

所有适配器在处理平台事件时均无 try-catch 保护：

- Discord: `bot.on('messageCreate')` 无错误边界
- Telegram: `bot.on('private_message')` 无错误边界  
- QQ: `bot.on('message.guild')` 无错误边界

单个事件处理异常会导致：
1. EventEmitter 将错误作为 'error' 事件传播
2. 如果无 'error' 监听器，进程直接崩溃
3. 所有后续事件处理被中断

### 建议修复

在适配器基类中提供统一的事件分发包装器：

```typescript
protected safeDispatch(event: string, handler: () => Promise<void>) {
    try {
        await handler();
    } catch (error) {
        this.logger.error(`Event handling failed for ${event}:`, error);
        this.emit('error', error);
    }
}
```

---

## 总结

| 优先级 | Issue | 类型 |
|--------|-------|------|
| P0 | #1 Account.start() 未 await | Bug/架构 |
| P0 | #2 removeAccount() 未 await | Bug/资源泄漏 |
| P0 | #9 测试覆盖率不足 | 质量/流程 |
| P1 | #3 createId() 无限递归 | Bug |
| P1 | #4 EventEmitter 内存泄漏 | 内存泄漏 |
| P1 | #5 QQ 适配器竞态条件 | Bug/并发 |
| P1 | #12 无错误边界 | 架构 |
| P2 | #6 messageIdMap 内存泄漏 | 内存泄漏 |
| P2 | #7 Discord 连接无超时 | Bug |
| P2 | #8 Telegram 安全隐患 | 安全 |
| P2 | #10 依赖版本不一致 | 维护性 |
| P2 | #11 Rate Limiter 无超时 | Bug |
