---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-feishu": patch
"@onebots/adapter-qq": patch
"@onebots/adapter-slack": patch
"@onebots/adapter-wechat": patch
"@onebots/adapter-wecom-kf": patch
"@onebots/adapter-whatsapp": patch
---

抽取与对象键顺序无关的 canonical JSON 指纹原语，统一多个适配器的事件回退身份；修复飞书事件缺少 `event_id` 时依赖接收时钟、导致重试事件获得不同 ID 的问题。
