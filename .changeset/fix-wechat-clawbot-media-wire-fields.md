---
"@onebots/adapter-wechat-clawbot": patch
---

修复 iLink 出站图片、视频和文件的 AES 密钥编码，并补齐图片尺寸、文件 MD5 等媒体线协议字段，避免微信客户端无法解密或打开媒体。
