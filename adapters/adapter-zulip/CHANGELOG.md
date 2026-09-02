# Changelog

## 3.0.12

### Patch Changes

- onebots@1.2.12

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

- 8ca837e: 增加 Zulip 自定义表情资源管理、增量事件订阅与标准 Emoji 生命周期投影。
- fe109c2: 增加 Zulip 现代 narrow 消息标记、批量匹配与举报 API，抽离消息动作模块，并补齐 `update_message_flags` 精确事件类型和 canonical 投影。
- 03d12d5: 增加 Zulip 用户静音、Alert Words 与完整状态管理动作，并默认订阅对应个人偏好事件。
- c9c7a8f: 补齐 Zulip 附件列表、删除、临时 URL 和缩略图状态 API，默认订阅并投影附件增改删事件；同时拆分 Zulip Event Queue 协议类型，保持 REST 与事件模块边界清晰。
- deb0a41: 增加完整的 Zulip 邮件邀请与复用邀请链接管理动作，严格校验角色和订阅参数，并默认订阅邀请变化事件。
- 2a3a211: 修正 Zulip Event Queue 快速重启时的轮询代次竞争，统一使用认证后的真实 Bot 身份投影事件与状态，并补齐默认心跳、重启订阅及队列超时类型。
- 2b10e85: 增加 Zulip 自定义资料字段完整资源管理与字段快照事件订阅。
- c823f09: 将账号启动取消信号传播到 Zulip 身份验证与 Event Queue，并清理忽略取消后迟到创建的服务器队列，防止旧启动任务恢复账号状态。
- 85784a8: 收紧 npm 发布边界：TypeScript 包不再携带测试产物，Web 管理端只发布构建后的 `dist`。发布流水线会真实打包全部工作区包，拒绝测试、源码、`node_modules` 泄漏或缺失入口的 tarball。
- 579e6cd: 统一 Zulip 配置、错误和 Event Queue 边界，并补齐定时消息、草稿、提醒与保存片段原生动作。
- 257a38c: 补齐 Zulip 频道详情、话题、订阅状态、邮件入口与话题删除 API，抽离频道动作模块，并修正频道归档为官方 DELETE 语义。
- f32637f: 增加 Zulip Linkifier 完整资源管理，并声明现代 URL Template 能力与默认事件订阅。
- 03e196a: 增加 canonical 用户组资源生命周期、成员与子组通知，默认订阅 Zulip 用户组事件并逐对象稳定投影，同时移除本地接收时间伪造。
- e1d5678: 闭合平台动作类型：不可变动作集合保留精确联合类型并支持动态字符串收窄，所有适配器从包入口统一导出动作集合、执行器与动作类型。
- 71fdd97: 完成全平台适配器能力清单，统一声明原生、模拟、权限、场景、事件、消息段与传输能力，并在运行时校验已声明动作确有具体实现，避免管理端和协议层暴露虚假能力。
- 941306a: 增加 Zulip Code Playground 资源动作与完整快照事件订阅。
- e69ebfc: 完善 Zulip 消息提醒查询、创建和删除的参数契约，补齐精确事件、默认订阅与 canonical 资源通知，并抽取个人资源事件模块。
- 5d0ee5f: 新增不可变平台动作注册表，并让首批适配器从单一 handler 表派生能力发现与执行。
- b67d335: 完善 Zulip 定时消息查询、创建、编辑和删除的现代参数契约，并补齐精确事件类型、默认订阅与 canonical 资源通知。
- e030790: 以顶层 receive_mode 统一 Event Queue 与 manual 接入，移除 event_queue.enabled 并公开手动事件投递能力。
- 74bbc4b: 收紧 Zulip Presence、话题可见性和输入状态的现代参数契约，增加消息编辑输入状态，并补齐精确事件与 canonical 通知。
- 7384925: 增加 Zulip 12 用户组创建、权限、停用、成员、子组和成员关系查询动作，并抽离可复用的结构化动作参数边界。
- 8df8c31: 增加 Zulip Bot API Key 与持久存储动作，并为底层官方 API 调用补齐 PUT 方法。
- 14b06b0: 收紧 Zulip 频道订阅与资料更新的现代参数契约，补齐批量订阅更新，并将频道生命周期和订阅关系事件投影为精确的 canonical 通知。
- d22f186: 增加 Zulip 允许邮箱域名的完整策略管理与事件订阅。
- 92b2d8a: 完善 Zulip 保存片段查询、创建、编辑和删除的严格参数契约，并补齐精确事件、默认订阅与 canonical 资源生命周期通知。
- 2b6a19a: 复用 core 的包元数据读取模块，移除适配器内重复且会静默回落为 `unknown` 的版本读取逻辑，并为 Heychat 与 Mock 补充实际适配器包版本。
- 9665836: 按 Telegram `allowed_updates` 与 Zulip `event_types` 展示账号真正可达的事件能力，并提供可复用的账号事件能力收窄工具。
- 902826b: 增加 Zulip 批量与单频道订阅属性设置，严格校验颜色、静音、置顶和通知属性的官方值类型。
- 7506409: 重构 Zulip 适配器：改用官方 Event Queue 长轮询与原生 HTTP 客户端，补齐可靠重连、结构化错误、可嵌入 Client、原始事件入口、频道话题、真实订阅成员、文件上传、事件投影和平台扩展动作；同时抽取可复用的动态选项列表表单，完善 Schema 与中英文文档。
- 1c41e72: 修正 Zulip Event Queue 在业务监听器失败前提前推进游标的问题，统一 canonical 事件的成功提交、重投与有界去重语义。
- 0d082ec: 完善 Zulip 草稿查询、批量创建、完整编辑和删除契约，并补齐精确事件、默认订阅与 canonical 资源通知。
- 83490a7: 统一由平台动作注册表派生不可变能力描述，保留各平台权限、上下文与场景差异，避免动作实现、Web 能力展示和支持动作查询发生漂移；微信公众号原生语言参数查询改用不与 canonical 动作冲突的 `get_wechat_user_info`。
- 7b25b13: 收紧 Zulip 11+ 独立频道创建动作：校验必填名称、订阅者、现代频道设置与创建态权限组，拒绝旧字段及更新态权限组对象。
- 6ae74a5: 增加 Zulip Channel Folder 的完整资源动作、精确事件类型与统一资源生命周期投影，并扩展核心资源类型。
- 074499d: 增加 Zulip 数据导出完整资源管理、授权查询与状态事件订阅。
- d3b1ce8: 补齐 Zulip 组织默认频道的管理员增删动作、精确快照事件和 canonical 策略通知，并完整声明既有频道事件能力。
- 7da1989: 新增 Zulip 组织新用户默认设置管理员动作、精确事件类型与 canonical 策略通知，并复用个人设置字段模型。
- 91a7db3: 新增 Zulip 本人账号与组织停用动作，并在能力清单中显式标记破坏性风险和组织 Owner 权限。
- 1ccb1c6: 完善 Zulip 消息检索契约：严格区分范围与消息 ID 查询，支持日期锚点及两种官方 narrow 结构，并拒绝废弃或互斥参数。
- c884f81: 增加 Zulip Navigation View 的完整资源动作、精确事件与统一资源投影，并抽离可复用的事件投影基元。
- 796c173: 新增 Zulip 当前账号 API Key 轮换动作，并明确声明成功后必须重配 Client 的敏感生命周期语义。
- 6f31b49: 增加当前账号资料读取、更新、清除及头像上传、删除动作，并复用严格的自定义资料校验与受控 multipart 上传。
- c22e26c: 增加严格类型化的 Zulip 组织成员创建、更新、停用与恢复动作，并在统一用户更新事件中区分停用和恢复语义。
- dd867b8: 补齐 Zulip 12 统一个人设置与管理员批量设置动作，并增加精确设置事件类型和 canonical 用户更新投影。
- aed2cd9: 新增 Zulip BigBlueButton、Nextcloud Talk、Webex 与 Constructor Groups 原生视频会议建会动作。
- 6b78045: 让手动与 Event Queue 入口等待 raw、精确类型、canonical 监听器及协议投影完成，成功后才提交去重和队列游标；启动失败不再被适配器静默吞掉。
- 9e70080: Zulip 停止时完整等待轮询并删除事件队列，清理失败不再被日志吞掉。
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
- 支持 Zulip REST API
- 支持 Zulip WebSocket API
- 支持流消息和私聊消息
- 支持消息编辑和删除
- 支持流管理
- 支持用户信息获取
- 支持自动重连
- 支持代理配置
