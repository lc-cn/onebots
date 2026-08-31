---
"@onebots/adapter-wechat-clawbot": patch
"@onebots/docs": patch
---

重构微信 ClawBot 的可取消无限轮询与账号生命周期，增加统一 `ingest(rawEvent)`、iLink start/stop 通知、指数退避、复合消息无损投影、原始事件、输入状态与加密媒体下载动作；移除伪好友列表和伪 CDN URL，并完善严格类型、配置 Schema、README、双语文档与测试。
