---
"@onebots/core": patch
"@onebots/adapter-icqq": patch
"@onebots/web": patch
---

适配新版 ICQQ 登录流程：`Adapter.VerificationRequest` 新增 `confirmable` 字段（无需输入、仅需用户确认的验证）。adapter-icqq 补监听 `system.login.auth` 身份验证事件并推送到 Web；扫码确认与身份验证完成后，用户可在 Web 管理端点击「继续登录」按钮，提交后显式调用 `client.login()` 继续登录流程（此前这两步缺少继续通路，登录会卡住）。
