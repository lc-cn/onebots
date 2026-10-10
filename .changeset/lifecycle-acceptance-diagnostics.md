---
"onebots": patch
---

补齐首次启用扩展及损坏配置修复的验收重启许可，Windows 生命周期失败仅输出经过白名单筛选的网关、快照对象及 ACL 核验原因诊断。

Windows 新建快照在发布前显式初始化当前宿主 owner 和闭合文件 ACL，既有文件保持只读严格核验，不再依赖创建令牌的默认 owner。

快照 ACL 的读写与现有 Windows 服务安全实现统一使用 .NET 文件系统接口，避免 PowerShell provider 的额外处理干扰固定路径核验。
