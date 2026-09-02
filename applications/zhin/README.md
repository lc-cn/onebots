# @onebots/application-zhin

Zhin 的 OneBots 兼容能力声明。它只描述 Zhin 使用 OneBot 11 时依赖的标准动作，不会新增连接路由，也不会代替协议配置开启 HTTP、WebSocket 或反向 WebSocket。

## 安装与启用

```bash
pnpm add @onebots/application-zhin
onebots -r <adapter> -p onebot-v11 -t zhin -c config.yaml
```

也可以持久化插件选择：

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [zhin]
```

正向 WebSocket 必须由用户在账号协议配置中显式开启：

```yaml
<platform>.<account_id>:
  onebot.v11:
    use_http: false
    use_ws: true
    access_token: <shared-token>
```

Zhin 连接标准地址 `ws://127.0.0.1:6727/<platform>/<account_id>/onebot/v11`。当前已验证动作是 `get_login_info` 和 `send_private_msg`；Application 本身不新增动作。

完整配置、验证和排查步骤见 [Zhin 解决方案](https://onebots.pages.dev/solution/zhin)。

## License

MIT
