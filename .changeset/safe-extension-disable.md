---
"onebots": patch
"@onebots/web": patch
"@onebots/docs": patch
---

扩展中心新增安全停用流程：先隔离预检移除插件后的候选配置，再原子更新启动选择并完成可验证重启；已安装依赖会保留，仍被账号或协议出口引用的扩展不会被停用。
