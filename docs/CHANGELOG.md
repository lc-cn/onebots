# @onebots/docs

## 0.5.4

### Patch Changes

- a058257: 新增完整 Facebook Messenger 适配器与共享 Meta 基础层：支持可嵌入 Client、已有 HTTP Host 和 manual 事件接入，覆盖 Messenger Platform canonical 事件/API、附件、会话、Profile、订阅、审核、Handover 与 Utility Messaging；同时提供严格签名和外部数据校验、动态账号能力、结构化 Web Schema、测试及双语文档。
- c07bb9a: 增加显式 `polling | manual` 接收模式；manual 保留 iLink 登录态与出站能力，但不创建内置长轮询，由现有 Host 调用 `WechatIlinkBot.ingest()` 接入事件。
- c460308: 增加 Heychat `websocket | manual` 接收模式、连接无关的 `ingest(rawEvent)` 与已升级 socket 接入；统一事件校验、序列去重、Schema、能力声明和文档。
- 4aa1321: 补齐 ICQQ 频道 tiny ID 提及、丰富消息段、黑名单、好友分组和头像 URL，修正链接分享字段顺序，并将可标准表达的原生消息从 icqq_raw 收敛为 canonical 段。
- cf51fc6: 新增七种机器人框架的版本化接入 profile、可复用连接方案生成接口和 `onebots frameworks` CLI，输出双方配置、端点、验证步骤与明确限制，并保持真实 token 不进入生成结果。
- a5c1a35: 抽取微信生态共享 JS-SDK 签名内核，补齐企业微信网页授权、访问者身份、企业/应用 ticket 缓存与签名动作，并收紧可选动作参数类型。
- c8ddbff: 补齐讨论组、QQ 频道、跨设备消息与已读、好友增减、群打卡、群主转让和输入状态事件桥接，并准确投影频道删除与隔离讨论组场景 ID。
- 71fdd97: 完成全平台适配器能力清单，统一声明原生、模拟、权限、场景、事件、消息段与传输能力，并在运行时校验已声明动作确有具体实现，避免管理端和协议层暴露虚假能力。
- 119df55: 统一 ICQQ 频道发送与撤回的 guild/channel 寻址和 opaque 消息 ID，并补齐频道分享、群文件容量与详情、跨群文件及离线文件转发扩展动作。
- 8690d16: 新增机器人框架接入兼容基线与互操作验证路线，覆盖 Koishi、NoneBot、Karin、Zhin、AlemonJS、云崽和真寻，并明确区分上游支持与 OneBots 已验证兼容。
- 329f109: 扩展停用现在发布稳定的活动操作与最近终态证据；管理页面在长预检请求断线或目录暂时不可读后会继续跟踪同一操作，并根据可信终态恢复重启或展示失败诊断。
- 18575c4: 扩展中心新增安全停用流程：先隔离预检移除插件后的候选配置，再原子更新启动选择并完成可验证重启；已安装依赖会保留，仍被账号或协议出口引用的扩展不会被停用。
- a82719a: 重构邮件适配器：统一 SMTP/IMAP 认证与代理配置，改用 IMAP IDLE 和无限重连，补齐线程、HTML、附件、查询、标记、目录管理、结构化错误与可嵌入 EmailClient，并同步完善 Schema、能力清单、测试及中英文文档。
- 0cfa54d: 重构微信 ClawBot 的可取消无限轮询与账号生命周期，增加统一 `ingest(rawEvent)`、iLink start/stop 通知、指数退避、复合消息无损投影、原始事件、输入状态与加密媒体下载动作；移除伪好友列表和伪 CDN URL，并完善严格类型、配置 Schema、README、双语文档与测试。
- dca581b: 重构企业微信自建应用适配器：严格接入官方加密回调与应用群聊语义，补齐统一客户端、原生动作、消息编译、结构化错误、事件保真、Schema、文档和测试；同时让通用配置 Schema 可声明顶层敏感字段，并在 Web 表单中使用密码输入。
- 376e05f: 重构微信客服适配器：按官方模型提供加密 Webhook、可嵌入 Client、可靠游标同步、完整富消息投影、结构化错误以及客服账号、接待人员、会话、客户、统计和素材原生动作；同步完善 Schema、README 与中英文文档。
- 7506409: 重构 Zulip 适配器：改用官方 Event Queue 长轮询与原生 HTTP 客户端，补齐可靠重连、结构化错误、可嵌入 Client、原始事件入口、频道话题、真实订阅成员、文件上传、事件投影和平台扩展动作；同时抽取可复用的动态选项列表表单，完善 Schema 与中英文文档。
- 569482d: 补齐微信公众号订阅通知、网页授权、缓存 JS-SDK ticket、签名配置与回调连通性诊断，命名动作不再静默忽略错误的可选参数类型，并同步闭合中英文配置文档。
- 02a36e1: 补齐 WhatsApp 批量用户封禁领域能力，提供结构化操作结果、E.164 校验和分页响应校验。
- 3669d8e: 增加 WhatsApp WABA 账户资料、受控更新与活动审计深模块，并移除重复的 Client 领域转发方法。
- 8e58fbb: 增加 WhatsApp Business Compliance 强类型读写能力、官方字段和跨字段校验，并补充能力清单与文档。
- 74d1f4e: 为 WhatsApp 适配器增加 Business Encryption 公钥深模块，覆盖 RSA 强度校验、multipart 上传、读取与签名状态校验。
- 4697921: 增加 WhatsApp WABA 号码资产查询、过滤、排序、分页与入驻创建深模块。
- c7d8eea: 将 WhatsApp Business Profile 抽为强类型深模块，补齐字段选择、响应校验与受控更新约束。
- dd76f34: 增加 WhatsApp WABA Schedule 管理，统一 Graph cursor 分页，并抽离 WhatsApp 配置 Schema 注册职责。
- ed5f250: 为 WhatsApp 适配器增加强类型 Calling API 控制平面，覆盖呼叫权限查询与申请、建立、预接受、接受、拒绝和终止动作，并明确 SDP 与媒体平面边界。
- b906279: 将 WhatsApp Commerce 设置抽离为强类型领域模块，补充官方响应校验并收紧更新边界。
- ff87b61: 增加 WhatsApp Conversational Automation 强类型模块，覆盖欢迎消息、引导问题、Bot 命令配置与 Bot 详情读取。
- 412ecc4: 为 WhatsApp 适配器增加 Payload Encryption 加密消息深模块，提供固定平台动作、compact JWE 校验与强类型加密响应。
- ec845fe: 抽离 WhatsApp Flows 领域模块，修正 multipart 创建与更新，补齐迁移、预览、endpoint metrics、JSON 资产和完整生命周期能力。
- 44c6f95: 补齐 WhatsApp Groups API 群消息、群资料与成员、设置、邀请链接、入群审批、参与者管理及结构化群 Webhook 投影，并支持 BSUID 用户身份。
- 40afcdb: 抽离 WhatsApp 媒体领域模块，补齐归属校验、官方 MIME 与大小约束、严格元数据和结构化删除响应。
- 1617c3d: 为 WhatsApp 适配器增加强类型消息投递历史模块，支持按 WAMID 查询、事件明细、受控分页和完整遍历。
- 959549d: 抽离 WhatsApp 消息模板领域模块，补齐按 ID 查询与编辑、namespace、精确删除、字段数组、分页、强类型响应和安全可扩展组件结构。
- 5ef33b6: 将 WhatsApp 号码资料、注册、注销和两步验证收拢为强类型深模块，并补充短信或语音验证码申请与校验能力。
- 13721bf: 为 WhatsApp 适配器增加强类型号码设置模块，覆盖 Calling、SIP、身份变化、payload encryption 与数据驻留配置。
- 591f273: 抽离 WhatsApp 消息二维码领域模块，补齐字段数组、PNG/SVG 图片生成、过滤、分页和官方响应校验，并提供完整强类型 Client API。
- 02427b8: 增加 WhatsApp Multi-Partner Solution 迁移意图的强类型查询、设置、响应校验与能力说明。
- 11f677b: 增加 WhatsApp WABA Webhook App 订阅管理，覆盖查询、默认或独立回调订阅、取消订阅及严格响应校验。

## 0.5.3

### Patch Changes

- b00497a: fix: 调整发布流程,做首次release

## 0.5.2

### Patch Changes

- 5d3787b: fix: v1.0.1

## 0.5.1

### Patch Changes

- 78d4de2: fix: bump version

## 0.5.0

### Minor Changes

- f3372b5: fix: refactory

### Patch Changes

- f3372b5: fix: 初始化管理
