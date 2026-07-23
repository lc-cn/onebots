# @onebots/adapter-wechat-clawbot

## 3.0.1

### Patch Changes

- 15b2540: 修复微信 ClawBot（iLink）登录二维码在 Web 管理端无法显示的问题：iLink 的 `qrcode_img_content` 是二维码页面 URL 而非图片，直接 `<img>` 展示会裂图。`Adapter.VerificationBlock` 新增 `qrcode` 内容块类型，适配器改发该类型（并附链接兜底），Web 管理端用 `qrcode` 库在本地渲染二维码图片。
- Updated dependencies [0519d6d]
- Updated dependencies [d9e67a0]
- Updated dependencies [fa90690]
  - onebots@1.2.1

## 3.0.0

### Patch Changes

- Updated dependencies [4564d68]
  - onebots@1.2.0

## 2.0.0

### Patch Changes

- Updated dependencies [d9fdbd5]
  - onebots@1.1.0

## 1.1.1

### Patch Changes

- b00497a: fix: 调整发布流程,做首次release
- Updated dependencies [b00497a]
  - onebots@1.0.7

## 1.1.0

### Minor Changes

- 5415d7b: ## `@onebots/adapter-wechat-clawbot`
  - 微信扩展（iLink Bot HTTP）适配器，平台标识 **`wechat-clawbot`**。
  - 会话目录：`data/wechat-clawbot/`；`context_token` 表 **`wechat_clawbot_context_token`**。

  ## `@onebots/adapter-wechat-clawbot`
  - WeChat extension via iLink Bot HTTP, platform id **`wechat-clawbot`**.
  - Session dir: `data/wechat-clawbot/`; context token table **`wechat_clawbot_context_token`**.
