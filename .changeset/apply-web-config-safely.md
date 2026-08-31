---
"@onebots/core": patch
"onebots": patch
"@onebots/web": patch
---

Web 配置保存现在会串行执行原子写盘与运行时热重载：应用失败时恢复上一版本，并发保存返回冲突；宿主网络等不可热重载字段会明确提示需要重启，界面在整个应用过程禁用重复提交。
