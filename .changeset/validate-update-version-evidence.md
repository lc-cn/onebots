---
"onebots": patch
---

更新器现在只接受 registry 与目标目录提供的精确 SemVer，并会脱敏和限制目标包暂存失败诊断，避免凭据随原始 stderr 进入日志。
