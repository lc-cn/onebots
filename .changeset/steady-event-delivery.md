---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-dingtalk": patch
"@onebots/adapter-feishu": patch
"@onebots/adapter-slack": patch
"@onebots/adapter-wechat": patch
"@onebots/adapter-wecom": patch
"@onebots/adapter-whatsapp": patch
"@onebots/protocol-onebot-v11": patch
"@onebots/protocol-onebot-v12": patch
"@onebots/protocol-milky-v1": patch
"@onebots/protocol-satori-v1": patch
---

新增可等待全部协议完成的 `Account.dispatchAwaited()`，协议广播会尝试并等待全部投递出口，反向 HTTP/Webhook 失败可反馈给可靠事件入口；钉钉与飞书统一等待异步监听器、合并并发重投，并仅在协议投递成功后确认和提交去重状态。钉钉与飞书缺少原生事件 ID 时改用确定性载荷身份。
