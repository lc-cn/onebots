# @onebots/application-zhin

OneBots 的 Zhin Application 扩展。它在 OneBot 11 协议实例上提供面向 Zhin 的专用正向 WebSocket、连接能力描述和扩展动作。

## 安装

```bash
pnpm add @onebots/application-zhin
```

## 启用

通过命令行加载：

```bash
onebots -r <adapter> -p onebot-v11 -t zhin -c config.yaml
```

或写入 OneBots 配置：

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [zhin]
```

## 连接

扩展会为每个 OneBot 11 协议实例增加以下正向 WebSocket：

```text
/<platform>/<account>/onebot/v11/applications/zhin
```

协议配置了 `access_token` 时，可通过查询参数 `access_token` 或 `Authorization: Bearer <token>` 鉴权。连接建立后会收到 OneBot 11 lifecycle 事件；动作请求和事件推送沿用 OneBot 11 报文。

扩展动作 `get_zhin_application_info` 可用于查询连接地址和必要动作。运行中的 Application 能力也可通过 OneBots 管理接口 `GET /api/applications` 查看。

## 能力边界

当前实现只对 `onebot.v11` 生效，并以 Zhin 6 的已验证连接方式为边界。其他协议会明确报告为不支持，不会被伪装为兼容。

完整说明见 [OneBots Zhin 解决方案文档](https://onebots.pages.dev/solution/zhin)。

## License

MIT
