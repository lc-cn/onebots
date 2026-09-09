---
"onebots": patch
---

删除已由管理服务命令取代的旧安装、启停、状态、日志、卸载、doctor 与 setup 实现，避免内部保留两套服务控制和配置写入路径。CLI 继续通过统一 manager/control 接口管理常驻服务、网关和扩展。
