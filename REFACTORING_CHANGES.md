# 重构变更总结

根据 @lc-cn 的反馈，已完成以下变更：

## 1. 移除向后兼容 ✅

- 删除了旧的 URL 格式支持 `/{platform}/{uin}/{version}`
- 现在只支持新格式：`/{platform}/{uin}/{protocol}/{version}`
- 更新了 Service、V11 和 V12 的路由逻辑
- 简化了日志输出，只显示一个URL

## 2. 移除 icqq 依赖 ✅

- 删除了 `src/adapters/icqq/` 整个目录
- 从 `package.json` 中移除了 `@icqqjs/icqq` 依赖
- 更新了 devDependencies 和 peerDependencies
- 更新了 package.json 描述为"多平台多协议的机器人应用启动器"

## 3. 重新设计数据库 ✅

- 删除了旧的 JsonDB 实现
- 将 `sqlite-db.ts` 重命名为 `db.ts` 作为唯一的数据库实现
- 使用 Node.js 内置的 `node:sqlite` 模块
- 简化了数据库结构

## 4. 重构适配器模式 ✅

### 新增文件

1. **`src/common-types.ts`** - 定义通用事件和动作结构
   - `CommonEvent` 命名空间：定义所有平台共享的事件结构
   - `CommonAction` 命名空间：定义所有平台共享的动作结构

2. **`src/adapter-new.ts`** - 新的适配器基类
   - 平台适配器实现 `extractEvent()` 方法将平台特定数据提取为通用格式
   - 平台适配器实现 `executeAction()` 方法执行通用动作
   - 使用 `handlePlatformEvent()` 处理平台事件并分发到协议实例

### 架构流程

```
平台原始事件 
    ↓ 
Platform Adapter.extractEvent() 
    ↓ 
CommonEvent (统一格式)
    ↓ 
OneBot.dispatch()
    ↓ 
Protocol.dispatchCommonEvent() (V11/V12/Milky/Satori)
    ↓ 
转换为协议特定格式并上报
```

### 优势

1. **平台适配器更简单**：只需实现数据提取到通用格式
2. **协议实现解耦**：协议只需知道如何处理通用事件
3. **易于扩展**：
   - 添加新平台：实现 `extractEvent()` 和 `executeAction()`
   - 添加新协议：实现 `dispatchCommonEvent()` 转换逻辑
4. **代码复用**：通用事件处理逻辑可以在协议间共享

## 文件变更摘要

### 删除的文件
- `src/adapters/icqq/index.ts`
- `src/adapters/icqq/utils.ts`
- `src/adapters/icqq/shareMusicCustom.ts`
- `src/sqlite-db.ts` (重命名为 db.ts)

### 新增的文件
- `src/common-types.ts` - 通用事件和动作类型定义
- `src/adapter-new.ts` - 新的适配器基类

### 修改的文件
- `package.json` - 移除 icqq 依赖
- `src/service.ts` - 移除向后兼容的路径
- `src/service/V11/index.ts` - 简化为单一URL格式
- `src/service/V12/index.ts` - 简化为单一URL格式
- `src/onebot.ts` - 更新 dispatch 方法使用通用事件
- `src/db.ts` - 从 sqlite-db.ts 重命名而来

## 下一步

现有的 qq、wechat、dingtalk 适配器需要更新以使用新的架构：
1. 继承新的 `Adapter` 基类（来自 `adapter-new.ts`）
2. 实现 `extractEvent()` 方法
3. 实现 `executeAction()` 方法
4. 实现 `call()` 方法

V11 和 V12 协议实现需要添加：
- `dispatchCommonEvent()` 方法来处理通用事件并转换为协议特定格式
