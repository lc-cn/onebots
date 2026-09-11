---
"onebots": patch
---

Windows 首次安装以最终 ACL 排他创建管理工作区，并通过 DACL 与原子 rename 发布受保护的服务定义，不再调用 Windows 不支持的文件描述符 chmod 或依赖硬链接；同时细分工作区初始化与定义写入的恢复阶段。
