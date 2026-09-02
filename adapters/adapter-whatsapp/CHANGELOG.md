# Changelog

## 3.0.11

### Patch Changes

- Updated dependencies [80600ef]
- Updated dependencies [a02ada0]
- Updated dependencies [ba672b9]
- Updated dependencies [e3eb81b]
- Updated dependencies [d449626]
- Updated dependencies [7f70d7a]
  - onebots@1.2.11

## 3.0.10

### Patch Changes

- Updated dependencies [d358230]
- Updated dependencies [8a0f0a8]
- Updated dependencies [42dc575]
- Updated dependencies [2df841a]
- Updated dependencies [285a0bd]
- Updated dependencies [85b15f7]
- Updated dependencies [1f396bd]
- Updated dependencies [d635329]
- Updated dependencies [ce480b1]
  - onebots@1.2.10

## 3.0.9

### Patch Changes

- f22eab6: 抽取与对象键顺序无关的 canonical JSON 指纹原语，统一多个适配器的事件回退身份；修复飞书事件缺少 `event_id` 时依赖接收时钟、导致重试事件获得不同 ID 的问题。
- 4cef9d7: 重构 WhatsApp Cloud API 适配器：统一 snake_case 配置与共享 HTTP Webhook，增加原始请求验签、重复投递过滤、完整事件投影、多段消息、媒体与管理动作、通用 Graph API 客户端，并移除 axios 和私有监听配置。

  同时将 Adapter 工厂类型收敛到注册表真实使用的 BaseApp 构造约定，避免严格模式下合法适配器需要类型断言。

- 91b61a5: 将 WhatsApp Groups 动作重构为组合式严格参数注册表，使执行、类型与能力识别共享单一来源，并拒绝契约外顶层字段。
- 799719b: 统一 WhatsApp manual、Webhook 与标准 Request 接入管线，增加 typed Client 事件、结构化错误、动态配置表单与严格 URL/路径校验。
- 85784a8: 收紧 npm 发布边界：TypeScript 包不再携带测试产物，Web 管理端只发布构建后的 `dist`。发布流水线会真实打包全部工作区包，拒绝测试、源码、`node_modules` 泄漏或缺失入口的 tarball。
- cd96164: 按 Meta 当前 Groups API 修正群邀请链接为获取与重置动作，移除不存在的直接添加成员能力，并让标准邀请明确返回平台不支持。
- 9477764: 将 WhatsApp Media 动作迁移到组合式严格参数注册表，使执行、类型与能力识别共享单一来源。
- a96484a: 将 WhatsApp WABA Webhook Subscription 动作迁移到统一严格契约，并闭合零参数取消订阅入口。
- 93ddee0: 闭合 WhatsApp Calling 动作契约，拒绝权限与信令动作中此前会被静默忽略的未知字段。
- e1d5678: 闭合平台动作类型：不可变动作集合保留精确联合类型并支持动态字符串收窄，所有适配器从包入口统一导出动作集合、执行器与动作类型。
- 355d245: 统一 WhatsApp Flows 动作与参数契约，并由实际处理器派生动作类型。
- 563e2ca: 统一 WhatsApp Marketing Messages 动作与参数契约，并导出精确动作类型。
- fdc5579: 统一 WhatsApp Official Business Account 动作与参数契约，并导出精确动作类型。
- 51d4124: 统一 WhatsApp QR Code 动作与参数契约，并由实际处理器派生动作类型。
- 74d1ca5: 统一 WhatsApp Business Schedules 动作与参数契约，并从包入口导出精确动作类型。
- 61a62b5: 统一 WhatsApp Message Templates 动作与参数契约，并由实际处理器派生动作类型。
- 71fdd97: 完成全平台适配器能力清单，统一声明原生、模拟、权限、场景、事件、消息段与传输能力，并在运行时校验已声明动作确有具体实现，避免管理端和协议层暴露虚假能力。
- a86ccda: 补齐适配器配置 Schema 的身份分区与敏感字段元数据，使 Web 表单稳定按语义组织账号配置，并以密码输入保护 token、secret 与加密密钥。
- 4cead9f: 将 QQ、Discord 与 WhatsApp 的平台扩展能力改为由实际动作注册表生成，并保留权限、场景与上下文约束。全仓统一契约会持续校验每个平台动作均可被能力发现，避免新增 API 时出现注册表与清单漂移。
- e3ca774: 增加 WhatsApp Marketing Messages 专用强类型发送能力，支持产品策略、消息活动共享和质量评估状态。
- 89cab5d: 闭合 WhatsApp 通用媒体自动上传、Template 与 Interactive 消息段及多段回复上下文，并报告账号实际使用的 Graph API 版本。
- c2bbba4: 为通用事件模型增加明确的消息状态通知，并让 WhatsApp 区分消息状态与内容编辑、修正自定义事件时间戳、收紧 Graph API 资源路径，同时仅从真实 Webhook 联系人资料回答用户查询。
- 1056dee: 抽取 WhatsApp 动作域契约工厂，统一未知参数错误并保持各领域 action 的精确类型推断。
- 7b5cd7a: 将 WhatsApp Conversational Automation 动作迁移到统一严格契约，保留欢迎消息、引导和命令的完整校验。
- e2c36b7: 闭合 WhatsApp Business Profile 动作与直接更新契约，使顶层和资料字段共享严格单一来源。
- 12ce15f: 统一 WhatsApp Business Account 动作契约，并从包入口补齐 WABA 资料、活动、分页与更新公共类型。
- 0133327: 统一 WhatsApp Business Phone Numbers 动作契约，并从包入口补齐号码资产、过滤、排序、分页与创建类型。
- 47fb330: 将 WhatsApp Blocked Users 动作迁移到统一严格契约，移除重复动作数组与 switch 分发。
- a6f7d75: 让 WhatsApp 账号启动响应 OneBots 生命周期取消信号，中止号码身份 Graph 请求，并在协议启动回滚时保持账号状态一致。
- e2cce57: 闭合 WhatsApp Webhook 与生命周期的可靠投递语义：按原始顺序尝试全部事件视图和监听器，任一出口失败时不提交去重并触发重投；manual 配置同时明确 `ingestHttp()` 与 `acceptHttp()` 所需凭据。
- 91f0a7f: 让七个适配器复用 core 的包版本读取模块，删除各自重复的文件读取、JSON 解析与错误处理实现。
- b250082: 闭合 WhatsApp Business Encryption 动作契约，明确拒绝额外私钥等此前被静默忽略的字段。
- 16eb63b: 闭合 WhatsApp Payload Encryption 动作契约，拒绝此前会被静默丢弃的额外明文字段。
- c925703: 将 WhatsApp Message History 动作迁移到统一严格契约，拒绝此前被查询投影静默忽略的拼错字段。
- bacfbc7: 新增可等待全部协议完成的 `Account.dispatchAwaited()`，协议广播会尝试并等待全部投递出口，反向 HTTP/Webhook 失败可反馈给可靠事件入口；钉钉与飞书统一等待异步监听器、合并并发重投，并仅在协议投递成功后确认和提交去重状态。钉钉与飞书缺少原生事件 ID 时改用确定性载荷身份。
- 20c29af: 将 WhatsApp Webhook、共享号码路由与手动入站统一为可等待的投递事务，异步监听器成功后才确认去重，并合并并发重投；抽离安全 Graph API 传输边界，新增 Commerce、消息二维码与 Flow 生命周期动作及稳定原生通知 ID。
- 57f1f9a: 闭合 WhatsApp Business Compliance 动作契约，拒绝查询和更新入口中被静默忽略的顶层字段。
- 839af71: 闭合 WhatsApp Phone Number 控制面动作契约，并拒绝注册与迁移 backup 中被静默忽略的未知字段。
- 6940866: 闭合 WhatsApp Phone Number Settings 顶层与嵌套契约，拒绝混合 feature 和此前被静默忽略的设置字段。
- cd27cbd: 闭合 WhatsApp Solution Migration 动作契约，拒绝迁移查询与 request 包装外被静默忽略的字段。
- 52c9a4a: 增加 WhatsApp Official Business Account 状态查询与强类型申请提交能力，按 Meta v23 正式 Schema 校验申请和响应。
- c5adc54: 将 WhatsApp Commerce 动作迁移到统一严格契约，并拒绝读取动作中被静默忽略的附加参数。
- 68d2721: 按 Phone Number ID 分流多号码 WABA Webhook，修正真实机器人身份和可取消启动生命周期，并将 WhatsApp Reaction 投影为 canonical notice。
- bcbeb50: 让 WhatsApp 与 Telegram 从单一不可变注册表派生平台动作发现与执行。
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
- Updated dependencies [022aa80]
- Updated dependencies [a058257]
- Updated dependencies [2ab0416]
- Updated dependencies [2cdd9a2]
- Updated dependencies [f8702ab]
- Updated dependencies [9cf29b8]
- Updated dependencies [6716778]
- Updated dependencies [1232a44]
- Updated dependencies [1aca612]
- Updated dependencies [d19d9a6]
- Updated dependencies [a74c75d]
- Updated dependencies [d4acf1d]
- Updated dependencies [7de9672]
- Updated dependencies [5ace043]
- Updated dependencies [8451a27]
- Updated dependencies [42dc286]
- Updated dependencies [d7eccb8]
- Updated dependencies [fb1a96d]
- Updated dependencies [cef9fe8]
- Updated dependencies [88f8e11]
- Updated dependencies [42cb227]
- Updated dependencies [fb45ed6]
- Updated dependencies [72eddec]
- Updated dependencies [1b843b1]
- Updated dependencies [b688f78]
- Updated dependencies [2755a9f]
- Updated dependencies [c669cae]
- Updated dependencies [f13bb5d]
- Updated dependencies [de86a5e]
- Updated dependencies [b2b3003]
- Updated dependencies [4691c3e]
- Updated dependencies [18ea42b]
- Updated dependencies [a430b23]
- Updated dependencies [c4b7fc0]
- Updated dependencies [b284ccc]
- Updated dependencies [6638635]
- Updated dependencies [69ae3cf]
- Updated dependencies [8903cca]
- Updated dependencies [422c5dc]
- Updated dependencies [47dec1e]
- Updated dependencies [a1ec2aa]
- Updated dependencies [0cd043e]
- Updated dependencies [650faf3]
- Updated dependencies [8bb7ae7]
- Updated dependencies [4253c75]
- Updated dependencies [4ca504e]
- Updated dependencies [f22eab6]
- Updated dependencies [9b08ce5]
- Updated dependencies [cf51fc6]
- Updated dependencies [002f1be]
- Updated dependencies [5a94953]
- Updated dependencies [7395a14]
- Updated dependencies [a3a22b4]
- Updated dependencies [b89cc37]
- Updated dependencies [9c9c2f9]
- Updated dependencies [90becd6]
- Updated dependencies [85784a8]
- Updated dependencies [fda6496]
- Updated dependencies [c855fc0]
- Updated dependencies [a5c1a35]
- Updated dependencies [3bf18f6]
- Updated dependencies [ed69269]
- Updated dependencies [a791a41]
- Updated dependencies [c495e37]
- Updated dependencies [0e1b962]
- Updated dependencies [6822b9d]
- Updated dependencies [75cf697]
- Updated dependencies [03e196a]
- Updated dependencies [f4c648f]
- Updated dependencies [4f510a1]
- Updated dependencies [4383e38]
- Updated dependencies [e7c4d95]
- Updated dependencies [967f14c]
- Updated dependencies [9806c68]
- Updated dependencies [c3d1cf4]
- Updated dependencies [e1d5678]
- Updated dependencies [ffc586a]
- Updated dependencies [dfa50e7]
- Updated dependencies [71fdd97]
- Updated dependencies [ef7d86b]
- Updated dependencies [0c7740c]
- Updated dependencies [c0b47c5]
- Updated dependencies [9e70080]
- Updated dependencies [a13c7e0]
- Updated dependencies [5d0ee5f]
- Updated dependencies [bc2609b]
- Updated dependencies [aaec929]
- Updated dependencies [8855d48]
- Updated dependencies [9b00c8b]
- Updated dependencies [cee3510]
- Updated dependencies [f66ba47]
- Updated dependencies [87e5353]
- Updated dependencies [610e1b6]
- Updated dependencies [e5b6f6f]
- Updated dependencies [543a02c]
- Updated dependencies [0fd3b1b]
- Updated dependencies [d3976ed]
- Updated dependencies [e4a2c30]
- Updated dependencies [b65736f]
- Updated dependencies [cef5489]
- Updated dependencies [a76a59b]
- Updated dependencies [fe08d63]
- Updated dependencies [1d83438]
- Updated dependencies [3111519]
- Updated dependencies [25bda51]
- Updated dependencies [04ec996]
- Updated dependencies [4c51578]
- Updated dependencies [4a49b75]
- Updated dependencies [27e42ca]
- Updated dependencies [0f37c6d]
- Updated dependencies [abd0009]
- Updated dependencies [99ff290]
- Updated dependencies [42b8ade]
- Updated dependencies [1a5dbb7]
- Updated dependencies [2389591]
- Updated dependencies [8a80658]
- Updated dependencies [6015fd7]
- Updated dependencies [0f4acc0]
- Updated dependencies [0070471]
- Updated dependencies [ab0e3a8]
- Updated dependencies [c59736d]
- Updated dependencies [5247361]
- Updated dependencies [7f0d5c8]
- Updated dependencies [a5c4f96]
- Updated dependencies [1a65be7]
- Updated dependencies [d43a159]
- Updated dependencies [34b2d31]
- Updated dependencies [3f5df08]
- Updated dependencies [bec5426]
- Updated dependencies [046e50e]
- Updated dependencies [cf439fc]
- Updated dependencies [d5a3f6b]
- Updated dependencies [2408c76]
- Updated dependencies [0de01b3]
- Updated dependencies [59300db]
- Updated dependencies [b4d1787]
- Updated dependencies [f5e1e8f]
- Updated dependencies [27c86a3]
- Updated dependencies [d35ccbc]
- Updated dependencies [52d79c6]
- Updated dependencies [3b3c26d]
- Updated dependencies [7224ff5]
- Updated dependencies [f6661b0]
- Updated dependencies [13bfca1]
- Updated dependencies [9a50312]
- Updated dependencies [ad2523d]
- Updated dependencies [3be2e2e]
- Updated dependencies [d17db13]
- Updated dependencies [2f0123f]
- Updated dependencies [0d3b010]
- Updated dependencies [8a23b82]
- Updated dependencies [2c6671a]
- Updated dependencies [bc6a29e]
- Updated dependencies [ee0b8d5]
- Updated dependencies [d410cb5]
- Updated dependencies [bce1fa0]
- Updated dependencies [ddb32bd]
- Updated dependencies [b9c962a]
- Updated dependencies [d38484c]
- Updated dependencies [beef089]
- Updated dependencies [1ffed04]
- Updated dependencies [aa89f81]
- Updated dependencies [1a5c11c]
- Updated dependencies [9ca94ae]
- Updated dependencies [5be37b3]
- Updated dependencies [c548700]
- Updated dependencies [454f528]
- Updated dependencies [6b4e8d5]
- Updated dependencies [1471cca]
- Updated dependencies [e3a0523]
- Updated dependencies [6de06a7]
- Updated dependencies [2e2d50d]
- Updated dependencies [d8a4c10]
- Updated dependencies [b83e594]
- Updated dependencies [486bb90]
- Updated dependencies [6cefa65]
- Updated dependencies [39ae2aa]
- Updated dependencies [860d03c]
- Updated dependencies [62a4cfc]
- Updated dependencies [061184f]
- Updated dependencies [abc80df]
- Updated dependencies [899d2f0]
- Updated dependencies [8980ee8]
- Updated dependencies [496f111]
- Updated dependencies [ae6ed2e]
- Updated dependencies [aad8f52]
- Updated dependencies [1296ab9]
- Updated dependencies [28a8ace]
- Updated dependencies [b4dae78]
- Updated dependencies [f321456]
- Updated dependencies [49a5628]
- Updated dependencies [febbf02]
- Updated dependencies [d73471e]
- Updated dependencies [58cbc7b]
- Updated dependencies [78e2b18]
- Updated dependencies [c175a49]
- Updated dependencies [329f109]
- Updated dependencies [0e99e8e]
- Updated dependencies [aa14384]
- Updated dependencies [d337b12]
- Updated dependencies [beda887]
- Updated dependencies [4420334]
- Updated dependencies [6165c44]
- Updated dependencies [6b356f3]
- Updated dependencies [50f7a9f]
- Updated dependencies [a468bfe]
- Updated dependencies [7953c9a]
- Updated dependencies [12ee2e0]
- Updated dependencies [7ab2d26]
- Updated dependencies [f6c6930]
- Updated dependencies [ea14830]
- Updated dependencies [2a0016a]
- Updated dependencies [f149bab]
- Updated dependencies [14ed8a6]
- Updated dependencies [3b3c3a1]
- Updated dependencies [c9a4ea8]
- Updated dependencies [371641a]
- Updated dependencies [f0a9cde]
- Updated dependencies [1faf73d]
- Updated dependencies [38eb759]
- Updated dependencies [d45f99b]
- Updated dependencies [957152a]
- Updated dependencies [5832766]
- Updated dependencies [3941b1d]
- Updated dependencies [fb93be0]
- Updated dependencies [e42f385]
- Updated dependencies [55683a5]
- Updated dependencies [1d3fe9e]
- Updated dependencies [a0a7658]
- Updated dependencies [2b6e60b]
- Updated dependencies [1f60104]
- Updated dependencies [61e5c69]
- Updated dependencies [17398bb]
- Updated dependencies [d94db9b]
- Updated dependencies [5de897a]
- Updated dependencies [c234f7e]
- Updated dependencies [d3c46d8]
- Updated dependencies [ea193f9]
- Updated dependencies [e562744]
- Updated dependencies [d424976]
- Updated dependencies [18575c4]
- Updated dependencies [a3df262]
- Updated dependencies [20a114f]
- Updated dependencies [49fbce3]
- Updated dependencies [393e28f]
- Updated dependencies [b25ada5]
- Updated dependencies [e0d1c0e]
- Updated dependencies [839d91b]
- Updated dependencies [6070cf8]
- Updated dependencies [4a55c2a]
- Updated dependencies [bf2f2fb]
- Updated dependencies [85f2191]
- Updated dependencies [be87f27]
- Updated dependencies [bdafc09]
- Updated dependencies [0141cea]
- Updated dependencies [2858c9f]
- Updated dependencies [9665836]
- Updated dependencies [48bfe11]
- Updated dependencies [1ef6488]
- Updated dependencies [335375b]
- Updated dependencies [88d3f2e]
- Updated dependencies [32a908e]
- Updated dependencies [bacfbc7]
- Updated dependencies [e8926ce]
- Updated dependencies [cd488ed]
- Updated dependencies [1bb83e0]
- Updated dependencies [9a5ca9b]
- Updated dependencies [34cccc4]
- Updated dependencies [02f1f17]
- Updated dependencies [e7774a7]
- Updated dependencies [1b02635]
- Updated dependencies [e7f17c5]
- Updated dependencies [a3df262]
- Updated dependencies [740bb95]
- Updated dependencies [6a88f9f]
- Updated dependencies [46ca10c]
- Updated dependencies [f72e8e2]
- Updated dependencies [99d5201]
- Updated dependencies [ab4fe3c]
- Updated dependencies [10361de]
- Updated dependencies [ff55a25]
- Updated dependencies [7477300]
- Updated dependencies [9fffc1a]
- Updated dependencies [a1da064]
- Updated dependencies [3ad5383]
- Updated dependencies [83490a7]
- Updated dependencies [3d99a6f]
- Updated dependencies [a61d820]
- Updated dependencies [8432713]
- Updated dependencies [fd00708]
- Updated dependencies [8fc9573]
- Updated dependencies [23346d5]
- Updated dependencies [0604bda]
- Updated dependencies [282e8e5]
- Updated dependencies [7f34ccd]
- Updated dependencies [b8475c0]
- Updated dependencies [d6b9f53]
- Updated dependencies [b26322f]
- Updated dependencies [10d462d]
- Updated dependencies [157b42f]
- Updated dependencies [889445a]
- Updated dependencies [b6f422c]
- Updated dependencies [f850284]
- Updated dependencies [103a6fd]
- Updated dependencies [25d7b92]
- Updated dependencies [0cfc799]
- Updated dependencies [6dd6abb]
- Updated dependencies [d75c0e8]
- Updated dependencies [6ff9be5]
- Updated dependencies [f9ce4cf]
- Updated dependencies [da99b42]
- Updated dependencies [3449a73]
- Updated dependencies [3670e84]
- Updated dependencies [6e02513]
- Updated dependencies [3c8e65d]
- Updated dependencies [f99ae64]
- Updated dependencies [43dbe29]
- Updated dependencies [dbb154f]
- Updated dependencies [e8f3f9f]
- Updated dependencies [9912261]
- Updated dependencies [aaa44ca]
- Updated dependencies [37322c8]
- Updated dependencies [5f983f9]
- Updated dependencies [70f57f1]
- Updated dependencies [e100e9d]
- Updated dependencies [ea02e1c]
- Updated dependencies [b4900e3]
- Updated dependencies [f2f3d86]
- Updated dependencies [5d13602]
- Updated dependencies [b01a43b]
- Updated dependencies [1965daa]
- Updated dependencies [54656da]
- Updated dependencies [1cf6fd0]
- Updated dependencies [e432abf]
- Updated dependencies [d2dcc54]
- Updated dependencies [0e4b4ff]
- Updated dependencies [9a66d16]
- Updated dependencies [5a91e42]
- Updated dependencies [781a17a]
- Updated dependencies [462fff3]
- Updated dependencies [cbd7c9e]
- Updated dependencies [cc540c2]
- Updated dependencies [0101b35]
- Updated dependencies [69fe867]
- Updated dependencies [656bdfb]
- Updated dependencies [0b21841]
- Updated dependencies [739d834]
- Updated dependencies [30f9679]
- Updated dependencies [7e38b87]
- Updated dependencies [3d87c88]
  - onebots@1.2.9

## 3.0.8

### Patch Changes

- Updated dependencies [9cc0622]
- Updated dependencies [c9e876c]
- Updated dependencies [a87f07a]
- Updated dependencies [f1493f6]
- Updated dependencies [78c1e50]
- Updated dependencies [03cc74d]
  - onebots@1.2.8

## 3.0.7

### Patch Changes

- onebots@1.2.7

## 3.0.6

### Patch Changes

- Updated dependencies [7891a2e]
  - onebots@1.2.6

## 3.0.5

### Patch Changes

- 41f4bcc: 改进 Web 配置、日志与验证管理，补充 MCP 和协议格式测试，并收紧核心、适配器及协议实现的公开类型。四个客户端 SDK 的事件扩展字段和默认响应数据由 `any` 收紧为 `unknown`，调用方需先进行类型收窄。
- Updated dependencies [41f4bcc]
  - onebots@1.2.5

## 3.0.4

### Patch Changes

- Updated dependencies [f472ebf]
  - onebots@1.2.4

## 3.0.3

### Patch Changes

- Updated dependencies [1f79a8a]
  - onebots@1.2.3

## 3.0.2

### Patch Changes

- Updated dependencies [4fd55a6]
  - onebots@1.2.2

## 3.0.1

### Patch Changes

- Updated dependencies [0519d6d]
- Updated dependencies [d9e67a0]
- Updated dependencies [fa90690]
  - onebots@1.2.1

## 3.0.0

### Patch Changes

- Updated dependencies [4564d68]
  - onebots@1.2.0

## 2.0.0

### Patch Changes

- Updated dependencies [d9fdbd5]
  - onebots@1.1.0

## 1.0.6

### Patch Changes

- b00497a: fix: 调整发布流程,做首次release
- Updated dependencies [b00497a]
  - onebots@1.0.7

## 1.0.5

### Patch Changes

- onebots@1.0.6

## 1.0.4

### Patch Changes

- Updated dependencies [4465ece]
  - onebots@1.0.5

## 1.0.3

### Patch Changes

- Updated dependencies [2645ccf]
  - onebots@1.0.4

## 1.0.2

### Patch Changes

- 5d3787b: fix: v1.0.1
- Updated dependencies [5d3787b]
  - onebots@1.0.3

## 1.0.1

### Patch Changes

- 78d4de2: fix: bump version
- Updated dependencies [78d4de2]
  - onebots@1.0.2

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-XX

### Added

- 初始版本发布
- 支持 WhatsApp Business API
- 支持消息发送与接收
- 支持文本、图片、视频、音频、文档、位置等消息类型
- 支持 Webhook 事件处理
- 支持消息状态跟踪
- 支持媒体文件下载
- 支持代理配置
