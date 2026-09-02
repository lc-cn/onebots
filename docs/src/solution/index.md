# 解决方案

这里按机器人框架给出可执行的接入手册。每一页只解决三件事：

1. 说明框架依赖的标准动作、平台私有动作和当前缺口；
2. 生成并配置 OneBots 账号、协议、传输和框架连接；
3. 用明确命令定位加载、网络、鉴权、动作与事件问题。

```bash
onebots frameworks
onebots frameworks --framework <framework> --account <platform.account_id>
onebots -r <adapter> -p <protocol> -t <framework> -c config.yaml
onebots doctor -c config.yaml
```

`-t` 只注册框架兼容扩展。是否启用 HTTP、正向 WebSocket、反向 WebSocket、SSE 或 Webhook，始终由 `config.yaml` 中的协议配置决定。

完整清单见[框架接入表](/solution/frameworks)。连接不通或动作缺失时查[排查手册](/solution/troubleshooting)。
