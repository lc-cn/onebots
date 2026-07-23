---
"@onebots/core": patch
"onebots": patch
"@onebots/web": patch
"@onebots/adapter-icqq": patch
"@onebots/adapter-wechat-clawbot": patch
"@onebots/adapter-wechat": patch
"@onebots/adapter-qq": patch
"@onebots/adapter-kook": patch
"@onebots/adapter-discord": patch
"@onebots/protocol-onebot-v11": patch
"@onebots/protocol-milky-v1": patch
---

登录验证与配置 Schema 体验修复：

- 微信 ClawBot 二维码过期自动换码后推送到 Web 并更新 UI；登录成功清理待处理验证
- ICQQ 将 `login_error` / `offline` 的 message 推送到验证面板，提供「重新登录」等快捷操作；扫码 / 身份验证 / 设备锁统一「已完成，继续登录」
- `VerificationRequest` 新增 `actions`、`confirmLabel`，网关支持 `verification:clear`
- 配置 Schema 彻底用 `choices` 替代 `enum`（含中文选项）；object 字段（如 `log_config`）留空不再默认写成 `{}`
