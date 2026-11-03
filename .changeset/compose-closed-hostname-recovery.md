---
"onebots": patch
---

修复 Docker Compose 正常关闭并重建容器后，默认 hostname 改变导致已关闭工作区无法接管、网关不能恢复的问题。保留工作区锁、worker 检查与异常退出的严格归属校验；不改变已有运行/停止意图。补充只读 hostname 诊断，并明确不支持复制管理状态跨主机。
