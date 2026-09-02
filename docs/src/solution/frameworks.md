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

- **available**：14 个具有固定配置或互操作证据的框架/发行版可通过 `-t` 激活，其中 Zhin 使用独立 npm Application 并具备专用 WebSocket。
- **experimental**：9 个具有明确协议接入面的框架、SDK 或发行版可激活，并提供连接模板与运行时兼容动作；固定版本互操作完成前不会标为稳定。
- **legacy**：PepperBot 与 NoneBot 1 可用于存量迁移，管理 API 会保留存量状态，新部署不推荐。

`experimental` 与 `legacy` 都是可运行状态。激活后，每个匹配协议都会增加唯一的 `get_<framework>_application_info` 动作；不匹配的协议会返回 `unsupported` 能力描述。

每个框架的启动命令、协议、连接方式和限制请从“解决方案”菜单进入对应页面。
