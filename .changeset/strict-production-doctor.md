---
"onebots": patch
---

为 `onebots doctor` 增加 `--strict` 生产门禁模式：任一诊断警告都会令报告失败、JSON `ok` 为 `false`，并返回退出码 1；已安装但停止的服务现在会明确标为警告，默认首次配置行为保持不变。
