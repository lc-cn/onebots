---
"@onebots/core": patch
"onebots": patch
---

让主应用与优雅停机在尝试全部生命周期清理步骤后传播数据库、Router、HTTP 及扩展资源的释放失败，同时保留嵌入式调用默认的尽力清理兼容行为。
