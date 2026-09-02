# 框架接入表

先按框架支持的协议选择方案，再运行生成命令；不要手写猜测连接地址。

| 框架 | 协议 | 连接方向 |
| --- | --- | --- |
| Koishi / Avilla | Satori v1 | 框架连接 OneBots |
| Karin | Milky v1 | 框架连接 OneBots |
| Walle | OneBot v12 | 框架连接 OneBots |
| NoneBot2、真寻、AstrBot、LangBot、AliceBot、Kotori、云崽、GenshinUID、NoneBot 1 | OneBot v11 | OneBots 连接框架 |
| Zhin、AlemonJS、melobot、ZeroBot、Kovi、OlivOS、炸毛、Shiro、Simbot、Overflow、Adachi-BOT、PepperBot | OneBot v11 | 框架连接 OneBots |

```bash
onebots frameworks --framework <framework> --account <platform.account_id>
```

输出中的 **OneBots 配置**负责账号协议与传输开关，**框架配置**负责框架端连接。Application 不会替用户开启传输。

## API 扩展规则

- `actions`：Application 确实新增或转换的动作；为空就表示没有注入动作。
- `requiredActions`：框架会调用的协议或平台动作。
- `unsupportedActions`：固定版本审计确认缺失的动作。
- 标准协议动作由 Protocol 实现；平台私有动作由 Adapter 能力决定。不能安全转换的动作必须保留为缺口。

云崽一类发行版可能依赖 QQ 文件、群公告、频道或资料私有动作。选择不具备相应能力的 Adapter 时，基础收发消息可能工作，但依赖这些动作的插件仍会失败。
