# 重构迁移指南 (Refactoring Migration Guide)

本文档说明了 onebots 项目的重构内容以及如何从旧版本迁移到新版本。

## 主要变更 (Major Changes)

### 1. 数据库迁移：JsonDB → SQLite

**变更内容：**
- 使用 Node.js 内置的 SQLite 数据库替代自定义 JsonDB
- 数据文件扩展名从 `.jsondb` 更改为 `.db`
- API 接口保持不变，无需修改代码

**迁移步骤：**

旧的数据文件会自动保留，新版本会创建新的 SQLite 数据库文件。如需迁移旧数据：

```bash
# 旧数据文件位置
~/.onebots/data/{uin}_v11.jsondb
~/.onebots/data/{uin}_v12.jsondb

# 新数据文件位置
~/.onebots/data/{uin}_v11.db
~/.onebots/data/{uin}_v12.db
```

**注意：** JsonDB 类已标记为废弃，但仍然保留以确保向后兼容。

### 2. 协议抽象层

**变更内容：**
- 新增 `protocols` 目录结构
- 创建了基础 `Protocol` 类
- 创建了 `ProtocolRegistry` 用于管理协议实现
- OneBot V11/V12 现在作为协议实现注册

**目录结构：**
```
src/
  protocols/
    base.ts           # 协议基类
    registry.ts       # 协议注册器
    index.ts          # 导出入口
    onebot/
      index.ts        # OneBot 协议注册
      v11.ts          # OneBot V11 实现
      v12.ts          # OneBot V12 实现
```

**扩展新协议：**

```typescript
import { Protocol } from "@/protocols/base";
import { ProtocolRegistry } from "@/protocols/registry";

// 实现新协议
class MilkyProtocol extends Protocol<"v1"> {
    public readonly name = "milky";
    public readonly version = "v1";
    
    // 实现抽象方法
    filterFn(event: Dict): boolean { /* ... */ }
    start(): void { /* ... */ }
    stop(): void { /* ... */ }
    dispatch(event: any): void { /* ... */ }
    format(event: string, payload: any): any { /* ... */ }
    apply(action: string, params?: any): Promise<any> { /* ... */ }
}

// 注册协议
ProtocolRegistry.register("milky", "v1", MilkyProtocol, {
    displayName: "Milky V1",
    description: "Milky 协议 V1 版本",
});
```

### 3. 公共工具提取

**新增工具模块：**

#### AdapterUtils
用于适配器的常用操作：

```typescript
import { AdapterUtils } from "onebots";

// 转换消息 ID（V11/V12 兼容）
const messageId = AdapterUtils.transformMessageId(oneBot, version, rawMessageId);

// 创建消息返回结果
const result = AdapterUtils.createMessageResult(oneBot, version, messageId);

// 获取包版本
const version = AdapterUtils.getPackageVersion("@icqqjs/icqq");

// 创建依赖字符串
const dependency = AdapterUtils.createDependencyString("@icqqjs/icqq");

// 解析复合 ID
const { type, parts } = AdapterUtils.parseCompositeId("guild:123:456");

// 创建复合 ID
const compositeId = AdapterUtils.createCompositeId("guild", "123", "456");
```

#### MessageUtils
用于消息处理和事件创建：

```typescript
import { MessageUtils } from "onebots";

// 格式化事件载荷
const payload = MessageUtils.formatEventPayload(data);

// 规范化发送者信息
const normalized = MessageUtils.normalizeSender(data);

// 创建消息事件
const messageEvent = MessageUtils.createMessageEvent("message", "private", data);

// 创建通知事件
const noticeEvent = MessageUtils.createNoticeEvent("group_increase", data);

// 创建请求事件
const requestEvent = MessageUtils.createRequestEvent("friend", data);

// 提取纯文本
const plainText = MessageUtils.extractPlainText(message);
```

### 4. URL 路由结构更新

**变更内容：**
- 支持新的协议优先的 URL 结构
- 保持完全向后兼容

**URL 格式：**

| 格式 | 示例 | 说明 |
|------|------|------|
| 旧格式（兼容） | `/icqq/123456/V11` | `/{platform}/{uin}/{version}` |
| 新格式（推荐） | `/icqq/123456/onebot/v11` | `/{platform}/{uin}/{protocol}/{version}` |

**访问方式：**

```bash
# HTTP API - 旧格式
curl http://127.0.0.1:6727/icqq/123456/V11/send_private_msg

# HTTP API - 新格式
curl http://127.0.0.1:6727/icqq/123456/onebot/v11/send_private_msg

# WebSocket - 旧格式
ws://127.0.0.1:6727/icqq/123456/V11

# WebSocket - 新格式
ws://127.0.0.1:6727/icqq/123456/onebot/v11
```

**配置文件无需修改**，两种格式的 URL 都会自动生效。

## 兼容性说明

### 完全兼容
- ✅ 所有旧的 URL 格式继续有效
- ✅ 配置文件格式无变化
- ✅ API 调用方式无变化
- ✅ 事件上报格式无变化

### 推荐迁移
- 📝 推荐使用新的 URL 格式以支持多协议
- 📝 推荐使用新的工具函数简化适配器开发

## 新功能

### 多协议支持

现在可以轻松添加新协议（如 Milky、Satori）：

1. 创建协议实现类（继承 `Protocol`）
2. 在 `ProtocolRegistry` 中注册
3. 在配置中指定使用的协议和版本

### 查询已注册的协议

```typescript
import { ProtocolRegistry } from "onebots";

// 获取所有协议名称
const protocols = ProtocolRegistry.getProtocolNames();
// => ["onebot"]

// 获取协议的所有版本
const versions = ProtocolRegistry.getVersions("onebot");
// => ["v11", "v12"]

// 获取协议元数据
const metadata = ProtocolRegistry.getMetadata("onebot");
// => { name: "onebot", displayName: "OneBot", ... }

// 检查协议是否存在
const exists = ProtocolRegistry.has("onebot", "v11");
// => true
```

## 开发者注意事项

### 适配器开发

使用新的工具函数可以大大简化适配器开发：

**之前：**
```typescript
async sendPrivateMessage(uin, version, args) {
    const [user_id, message] = args;
    const result = await this.bot.sendPrivateMsg(user_id, message);
    return {
        message_id: version === "V11" 
            ? this.oneBots.get(uin).V11.transformToInt("message_id", result.message_id)
            : result.message_id
    };
}
```

**现在：**
```typescript
import { AdapterUtils } from "onebots";

async sendPrivateMessage(uin, version, args) {
    const [user_id, message] = args;
    const result = await this.bot.sendPrivateMsg(user_id, message);
    const oneBot = this.getOneBot(uin);
    return AdapterUtils.createMessageResult(oneBot, version, result.message_id);
}
```

### 数据库操作

SqliteDB 提供与 JsonDB 相同的 API，无需修改代码：

```typescript
import { SqliteDB } from "onebots";

const db = new SqliteDB("/path/to/database");

// 所有操作与 JsonDB 相同
db.set("key", value);
const value = db.get("key");
db.push("array", item);
// ...
```

## 常见问题

### Q: 我需要修改现有配置吗？
A: 不需要。配置文件格式保持不变，所有现有配置继续有效。

### Q: 旧的 URL 还能用吗？
A: 可以。旧的 URL 格式完全兼容，新旧格式可以同时使用。

### Q: 如何切换到 SQLite 数据库？
A: 自动切换。新版本会自动使用 SQLite，旧的 JsonDB 文件会保留但不再使用。

### Q: 如何添加新的协议支持？
A: 参考上述"扩展新协议"部分，实现 Protocol 类并在 ProtocolRegistry 中注册即可。

### Q: 性能有提升吗？
A: 是的。SQLite 数据库在大量数据读写时性能优于基于文件的 JsonDB。

## 升级检查清单

- [ ] 备份现有配置文件和数据目录
- [ ] 安装新版本
- [ ] 启动服务，检查日志确认新旧 URL 都已生效
- [ ] 测试现有功能是否正常
- [ ] （可选）更新客户端使用新的 URL 格式
- [ ] （可选）清理旧的 `.jsondb` 数据文件

## 获取帮助

如果在迁移过程中遇到问题：

1. 查看日志文件：`~/.onebots/onebots.log`
2. 提交 Issue：[GitHub Issues](https://github.com/lc-cn/onebots/issues)
3. 加入 QQ 群：860669870

---

最后更新：2025-11-20
