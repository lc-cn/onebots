# 机器人框架解决方案

机器人框架现在是 OneBots 的第三类运行时扩展 **Application**，与 Adapter、Protocol 同级。启动顺序是：

```text
-r Adapter → -p Protocol → -t Application → 创建账号和协议实例 → Application 注入协议扩展
```

```bash
onebots -r mock -p onebot-v11 -t zhin
```

Application 可以组合协议的启动/停止、动作调用和事件投递，并为每个协议实例公开兼容动作、专用路由、连接方式和限制。`GET /api/applications` 返回已注册项、当前激活项以及逐账号协议能力。外部包使用 `@onebots/application-<name>`、`onebots-application-<name>` 或原始包名。

## 支持状态

- **available**：14 个框架/发行版可通过 `-t` 激活，其中 Zhin 使用独立 npm Application 并具备专用 WebSocket。
- **planned**：11 个调研对象已进入同一注册表，但在提供实现和固定版本门禁前会拒绝激活。

每个框架的启动命令、协议、连接方式和限制请从“解决方案”菜单进入对应页面。
