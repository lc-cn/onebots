---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-line": patch
"@onebots/adapter-wechat": patch
"@onebots/adapter-wecom": patch
"@onebots/adapter-wecom-kf": patch
---

抽取代次安全的异步凭证缓存、有序受控并发与统一 API 路径校验，供多个适配器复用；企业微信与微信客服不再因旧请求的迟到错误清空新 token，并拒绝路径内嵌 query/fragment，同时将企业微信菜单与模板卡片回调投影为统一交互事件。
