---
"@onebots/adapter-dingtalk": patch
"@onebots/adapter-discord": patch
"@onebots/adapter-email": patch
"@onebots/adapter-feishu": patch
"@onebots/adapter-heychat": patch
"@onebots/adapter-icqq": patch
"@onebots/adapter-kook": patch
"@onebots/adapter-line": patch
"@onebots/adapter-mock": patch
"@onebots/adapter-qq": patch
"@onebots/adapter-slack": patch
"@onebots/adapter-teams": patch
"@onebots/adapter-telegram": patch
"@onebots/adapter-wechat": patch
"@onebots/adapter-wechat-clawbot": patch
"@onebots/adapter-wecom": patch
"@onebots/adapter-wecom-kf": patch
"@onebots/adapter-whatsapp": patch
"@onebots/adapter-zulip": patch
"@onebots/core": patch
"imhelper": patch
"onebots": patch
"@onebots/web": patch
"@onebots/protocol-mcp-v1": patch
"@onebots/mcp-client": patch
"@onebots/protocol-milky-v1": patch
"@imhelper/milky-v1": patch
"@onebots/protocol-onebot-v11": patch
"@imhelper/onebot-v11": patch
"@onebots/protocol-onebot-v12": patch
"@imhelper/onebot-v12": patch
"@onebots/protocol-satori-v1": patch
"@imhelper/satori-v1": patch
---

收紧 npm 发布边界：TypeScript 包不再携带测试产物，Web 管理端只发布构建后的 `dist`。发布流水线会真实打包全部工作区包，拒绝测试、源码、`node_modules` 泄漏或缺失入口的 tarball。
