---
"onebots": patch
"@onebots/core": patch
"@onebots/web": patch
---

管理服务在配置损坏时提供显式修复草稿，保留原始字节私有备份，并统一 CLI、TUI、Web 的验证与应用流程。修复失败和中断时保留恢复门禁，仅允许本地对账恢复；确认网关进程组已清理后才解除启动失败状态。
