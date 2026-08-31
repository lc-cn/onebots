---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-discord": patch
"@onebots/adapter-kook": patch
---

抽取 HTTP、本地文件、data URL 与 Base64 媒体来源的统一物化模块，并由 Discord 与 KOOK 共享。

KOOK 发送图片、音频、视频和文件前会通过当前机器人上传素材，同时修正首次身份请求失败后账号无法自动恢复的问题。
