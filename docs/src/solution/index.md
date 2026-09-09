# 解决方案

这里按机器人框架给出可执行的接入手册。每一页只解决三件事：

1. 说明框架依赖的标准动作、平台私有动作和当前缺口；
2. 生成并配置 OneBots 账号、协议、传输和框架连接；
3. 用明确命令定位加载、网络、鉴权、动作与事件问题。

```bash
onebots frameworks
onebots frameworks --framework <framework> --account <platform.account_id>
onebots ui --data-dir /path/to/onebots-data
onebots doctor --data-dir /path/to/onebots-data
```

在 Web 或 TUI 的安装计划中选择框架兼容扩展、平台适配器和输出协议。是否启用 HTTP、正向 WebSocket、反向 WebSocket、SSE 或 Webhook，始终由账号的协议配置决定。

完整清单见[框架接入表](/solution/frameworks)。连接不通或动作缺失时查[排查手册](/solution/troubleshooting)。
