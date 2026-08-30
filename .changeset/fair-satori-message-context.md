---
"imhelper": patch
"@imhelper/milky-v1": patch
"@imhelper/satori-v1": patch
"@onebots/protocol-satori-v1": patch
---

为消息行为保留场景与频道上下文，并为父级依赖目录增加显式 scope。Satori 私聊先创建真实直接消息频道，回复、撤回、编辑与 reaction 原样使用事件 channel_id，同时补齐频道目录、重命名、好友删除、申请处理、Element 编解码与频道消息删除事件。
