---
"@onebots/core": patch
"onebots": patch
"@onebots/web": patch
---

闭合 Web 重启请求的实例身份链。管理端现在携带预探测到的实例身份，服务端在预检前拒绝已被其他进程接管的过期请求，并返回应用、实例与调度状态；Web 只有验证完整回执后才等待新实例上线。
