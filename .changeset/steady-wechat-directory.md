---
"@onebots/adapter-wechat": patch
"@onebots/core": patch
---

为统一事件增加好友移除通知，并让微信公众号准确投影关注关系、菜单交互与消息状态；同时为关注者目录增加分页去重与停滞游标保护，收紧通用 API 路径，避免迟到的旧 token 错误清空已经刷新的访问令牌。
