---
"onebots": patch
"@onebots/core": patch
"@onebots/web": patch
---

将依赖安装统一为管理服务控制的候选运行版本流程：固定宿主与核心身份，安装必需 peer，隔离临时私有仓库授权，独立验证插件与配置 Schema，再显式切换运行版本。CLI 与 Web 共用安装接口；安装或网关失败不关闭管理端，也不自动创建账号或启用协议。
