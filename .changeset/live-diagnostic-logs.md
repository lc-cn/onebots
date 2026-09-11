---
"@onebots/core": patch
"@onebots/web": patch
"onebots": patch
---

重整“运行与诊断”页面的信息层级，并将管理服务、网关和控制操作日志改为三个实时标签页。进入页面或切换标签时自动建立带设备认证的 SSE 连接，离开页面、切换来源或更换会话时立即断开。
