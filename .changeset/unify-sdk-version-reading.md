---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-dingtalk": patch
"@onebots/adapter-icqq": patch
---

提供显式读取底层依赖 package.json 版本的公共入口，并让钉钉与 ICQQ 删除最后两套重复包元数据解析逻辑，同时继续准确报告 SDK 版本。
