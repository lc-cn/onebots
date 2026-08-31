---
"@onebots/adapter-wechat": patch
"@onebots/adapter-wecom": patch
---

闭合微信公众号媒体来源上传、视频缩略图和外部事件校验，并让两种微信适配器优先复用入站 canonical 段中的平台素材 ID，避免无意义的重复上传。
