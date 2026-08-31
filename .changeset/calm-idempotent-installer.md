---
"onebots": patch
---

一键安装脚本支持安全重复执行：已有配置不再被 setup 参数改写，更新服务定义后切换运行实例；PowerShell 对 npm 和 OneBots 原生命令显式检查退出码，失败时立即停止。
