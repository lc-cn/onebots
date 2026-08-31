---
"@onebots/core": patch
"onebots": patch
---

拒绝空数据库路径，并让 doctor 验证解析后的实际 SQLite 文件及父目录，将绝对路径和逃离默认数据目录的相对路径纳入部署门禁。
