---
"@onebots/core": patch
"@onebots/adapter-wechat-clawbot": patch
"@onebots/web": patch
---

修复微信 ClawBot（iLink）登录二维码在 Web 管理端无法显示的问题：iLink 的 `qrcode_img_content` 是二维码页面 URL 而非图片，直接 `<img>` 展示会裂图。`Adapter.VerificationBlock` 新增 `qrcode` 内容块类型，适配器改发该类型（并附链接兜底），Web 管理端用 `qrcode` 库在本地渲染二维码图片。
