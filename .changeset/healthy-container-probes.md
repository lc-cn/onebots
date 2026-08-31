---
"onebots": patch
---

为官方 Docker 镜像和 Compose 部署增加基于 `/ready` 的容器健康检查；探针会读取持久化配置中的端口与路径，支持 `PORT`、`ONEBOTS_PATH`、`ONEBOTS_CONFIG_PATH` 和完整 URL 环境变量覆盖，并验证响应明确包含 `ready: true`。
