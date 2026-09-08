---
"onebots": patch
"@onebots/core": patch
"@onebots/web": patch
---

分离常驻管理服务与网关子进程，提供统一控制客户端、私有配对认证、持久化启停状态与公共协议转发。Docker 空白工作区直接提供管理端，停止网关不再关闭 Web。此变更随完整服务架构迁移统一交付。
