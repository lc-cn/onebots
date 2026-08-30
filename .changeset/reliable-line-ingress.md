---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-line": patch
"@onebots/adapter-teams": patch
"@onebots/adapter-feishu": patch
"@onebots/adapter-dingtalk": patch
---

新增可复用的 `ReliableEventIngress`，统一事件并发合并、成功后提交和失败重投语义，并让 Teams、飞书与钉钉删除各自重复的投递状态机。

让 LINE Webhook、`ingestHttp()` 与 manual `ingest()` 等待异步监听器和全部协议出口；投递失败不提交持久化去重状态，并发重投只执行一次且准确报告 duplicate。同步更新类型、Schema 提示、能力说明、README 与回归测试。
