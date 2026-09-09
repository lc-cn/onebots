---
"onebots": patch
---

移除旧 `App/createOnebots` 嵌入式管理宿主和内部 `--service-runtime` 入口，统一由常驻管理服务启动独立网关并使用设备会话管理。
