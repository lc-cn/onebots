# @onebots/adapter-mock

onebots Mock 适配器 - 用于测试和开发环境。

## 特性

- ✅ **无外部依赖**：不需要真实的机器人账号或服务
- ✅ **精确能力**：只声明已真实模拟的 API，不伪造成功结果
- ✅ **可靠事件入口**：自动事件与手动事件都经过可等待的 typed `ingest()`
- ✅ **可复现事件**：随机种子、时钟、随机源和等待器均可控制
- ✅ **模拟数据**：预置好友、群组等模拟数据
- ✅ **结构化错误**：可通过稳定的 `MockError.code` 精确断言失败原因
- ✅ **CI/CD 友好**：适合在自动化测试环境中使用

## 安装

```bash
npm install @onebots/adapter-mock
# 或
pnpm add @onebots/adapter-mock
```

## 配置

```yaml
mock.test_bot:
  nickname: "测试机器人"
  avatar: "https://via.placeholder.com/100"
  auto_events: false # 是否自动生成模拟事件
  event_interval: 5000 # 事件生成间隔（毫秒）
  auto_event_types: [private_message, group_message] # 可选事件白名单
  random_seed: 2026 # 可选；使自动事件选择可复现
  latency: 10 # 模拟 API 延迟（毫秒）

  # 预定义好友列表
  friends:
    - user_id: "10001"
      nickname: "测试好友1"
    - user_id: "10002"
      nickname: "测试好友2"

  # 预定义群组
  groups:
    - group_id: "100001"
      group_name: "测试群"
      member_count: 50
      members:
        - user_id: "10001"
          nickname: "群主"
          role: "owner"
```

## 在测试中使用

```typescript
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { MockBot, type MockIncomingMessage } from "@onebots/adapter-mock";

describe("Bot Tests", () => {
  let bot: MockBot;

  beforeAll(async () => {
    bot = new MockBot({
      account_id: "test_bot",
      nickname: "Test Bot",
      latency: 0, // 测试时禁用延迟
    });
    await bot.start();
  });

  afterAll(async () => {
    await bot.stop();
  });

  test("getLoginInfo", async () => {
    const info = await bot.getLoginInfo();
    expect(info.user_id).toBe("test_bot");
    expect(info.nickname).toBe("Test Bot");
  });

  test("getFriendList", async () => {
    const friends = await bot.getFriendList();
    expect(friends.length).toBeGreaterThan(0);
  });

  test("sendMessage", async () => {
    const result = await bot.sendMessage("10001", "Hello!", "private");
    expect(result.message_id).toBeDefined();
  });

  test("手动触发事件", async () => {
    const events: MockIncomingMessage[] = [];
    bot.on("message", event => events.push(event));

    // 手动触发消息事件
    await bot.triggerEvent("message", {
      type: "private",
      message_id: "test_msg_1",
      user_id: "10001",
      nickname: "测试好友",
      content: "测试消息",
      time: Math.floor(Date.now() / 1000),
    });

    expect(events.length).toBe(1);
    expect(events[0].content).toBe("测试消息");
  });
});
```

## API

### MockBot

| 方法                                   | 说明           |
| -------------------------------------- | -------------- |
| `start()`                              | 启动机器人     |
| `stop()`                               | 停止机器人     |
| `getLoginInfo()`                       | 获取登录信息   |
| `getFriendList()`                      | 获取好友列表   |
| `getGroupList()`                       | 获取群组列表   |
| `getGroupInfo(groupId)`                | 获取群组信息   |
| `getGroupMemberList(groupId)`          | 获取群成员列表 |
| `getGroupMemberInfo(groupId, userId)`  | 获取群成员资料 |
| `getUserInfo(userId)`                  | 获取用户信息   |
| `sendMessage(targetId, message, type)` | 发送消息       |
| `deleteMessage(messageId)`             | 删除消息       |
| `getMessage(messageId)`                | 获取消息快照   |

### 测试辅助方法

| 方法                        | 说明                                        |
| --------------------------- | ------------------------------------------- |
| `ingest(event)`             | 投递结构化入站事件，等待全部监听器完成      |
| `triggerEvent(event, data)` | 按事件名投递 typed 事件，等待全部监听器完成 |
| `addFriend(friend)`         | 添加模拟好友                                |
| `addGroup(group)`           | 添加模拟群组                                |
| `getSentMessages()`         | 仅获取出站消息快照                          |
| `getReceivedMessages()`     | 仅获取入站消息快照                          |
| `clearData()`               | 清除所有模拟数据，不会自动恢复默认数据      |
| `isActive()`                | 检查是否正在运行                            |

## 事件

| 事件           | 说明                   |
| -------------- | ---------------------- |
| `ready`        | 机器人就绪             |
| `message`      | 收到消息               |
| `request`      | 收到请求（好友申请等） |
| `heartbeat`    | 心跳                   |
| `stopped`      | 机器人停止             |
| `message_sent` | 消息发送成功           |
| `client_error` | 延迟任务等异步错误     |

Web 管理端会根据 Schema 把好友、群组和自动事件类型渲染为可动态增删的结构化列表，无需手写 JSON；群组中未展示的 `members` 等扩展字段在编辑后仍会保留。

Mock 仅声明并接受文本消息段。传入图片、文件等未模拟消息段会明确报错，避免测试把占位字符串误判为平台支持。`latency: 0` 可用于完全关闭模拟延迟；停止正在启动的 Bot 会取消过期的 `ready` 和 `message_sent` 事件。构造器第二个参数可注入 `now`、`random`、`sleep`，用于完全确定性的测试。

`ingest()` 与 `triggerEvent()` 返回的 Promise 会等待适配器投影和全部协议分发完成；任一监听器失败时，其他监听器仍会获得事件，最终向调用方传播单个错误或 `AggregateError`。自动事件按生成顺序串行投递，投递失败通过结构化 `client_error` 暴露，避免定时器产生未处理拒绝。

## 许可证

MIT
