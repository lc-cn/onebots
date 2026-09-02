# @onebots/adapter-heychat

## 4.0.11

### Patch Changes

- b806e6f: 明确平台 ID 的类型保真契约：原始数字直接作为统一数字 ID，并同时生成字符串形式；只有原始字符串才分配稳定的唯一数字映射。修复 Telegram、企业微信和 HeyChat 提前字符串化数字 ID 的问题。
  - onebots@1.2.12

## 4.0.10

### Patch Changes

- Updated dependencies [80600ef]
- Updated dependencies [a02ada0]
- Updated dependencies [ba672b9]
- Updated dependencies [e3eb81b]
- Updated dependencies [d449626]
- Updated dependencies [7f70d7a]
  - onebots@1.2.11

## 4.0.9

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

## 4.0.8

### Patch Changes

- c460308: 增加 Heychat `websocket | manual` 接收模式、连接无关的 `ingest(rawEvent)` 与已升级 socket 接入；统一事件校验、序列去重、Schema、能力声明和文档。
- 734643a: 统一黑盒语音动作、资源、配置、协议与网络错误，抽离频道和成员模型投影，收紧适配器账号、ID 与客户端事件类型边界。
- 46c318f: 收紧黑盒语音频道寻址与 API 路径边界，不再把房间 ID 猜测为任意频道；为回应和卡片交互补齐 guild/channel 身份与上下文缓存，统一机器人状态身份，并为 WebSocket 握手增加超时保护。
- 85784a8: 收紧 npm 发布边界：TypeScript 包不再携带测试产物，Web 管理端只发布构建后的 `dist`。发布流水线会真实打包全部工作区包，拒绝测试、源码、`node_modules` 泄漏或缺失入口的 tarball。
- 40c189f: 闭合黑盒语音底层调用、媒体上传与 OAuth 动作参数，拒绝拼错或夹带的顶层字段并返回动作上下文。
- e1d5678: 闭合平台动作类型：不可变动作集合保留精确联合类型并支持动态字符串收窄，所有适配器从包入口统一导出动作集合、执行器与动作类型。
- 71fdd97: 完成全平台适配器能力清单，统一声明原生、模拟、权限、场景、事件、消息段与传输能力，并在运行时校验已声明动作确有具体实现，避免管理端和协议层暴露虚假能力。
- a86ccda: 补齐适配器配置 Schema 的身份分区与敏感字段元数据，使 Web 表单稳定按语义组织账号配置，并以密码输入保护 token、secret 与加密密钥。
- 4fb5a8b: 让 Heychat 事件入口等待全部协议投影完成后才确认序号或结束本地重试，闭合手动连接与已升级 WebSocket 的可靠投递链。
- 76cfec9: 重构黑盒语音适配器的 REST、WebSocket、事件投影与消息编译边界，按官方文档补齐私聊、富消息、回应、房间、成员、角色、频道、权限和语音流能力；移除未经官方定义的普通消息与 webhook 声明，并提供结构化错误、无限重连、受限底层 API、动态配置 Schema、准确 README 和回归测试。
- a950886: 统一保留频道事件的服务器与频道双层地址，修正 OneBot V12 和 Satori 的频道事件投影，并让 OneBot V12 发送使用独立的 `guild_id` 与 `channel_id`。
- 2e2d50d: 将远程 canonical 路由限制在正式 Adapter 动作面，显式修复 `get_supported_actions` 调用，并拒绝会被 canonical 路由遮蔽的平台扩展动作。移除 HeyChat 频道管理与 LINE 退群动作的重复注册；这些能力继续通过对应 canonical 动作提供。
- 1a14632: 让黑盒语音账号启动响应 OneBots 生命周期取消信号，终止未完成的 WebSocket 握手和重连，并修正配置字段文档。
- 2b6a19a: 复用 core 的包元数据读取模块，移除适配器内重复且会静默回落为 `unknown` 的版本读取逻辑，并为 Heychat 与 Mock 补充实际适配器包版本。
- dc6e785: 将 HeyChat 事件入口改为串行成功确认：业务失败不再提前推进序号，显式 ingest 可重投，socket 来源会按退避策略保留并重试事件，同时区分协议帧错误与业务投递错误。
- 68c600e: 为黑盒语音客户端增加单航班启动，并在停止时等待本地事件队列及完整清理所有连接资源。
- 3fc1b02: 补齐黑盒语音用户 OAuth 授权、令牌刷新、用户资料和语音时长能力，并隔离机器人令牌与 OAuth 应用凭据。
- 3f0c094: 闭合黑盒语音图片与文件上传，收紧消息段、统一 ID、REST/WS URL 和事件无损投影，并让新 WebSocket 连接使用独立 sequence 代次。
- 67bdebd: 统一九个适配器的严格 TypeScript 契约，并收紧 Discord 成员、Slack 消息以及 LINE、Teams、Telegram 可空数据的运行时边界。
- 02f1f17: 新增可复用的声明式 HTTP 平台动作契约，统一校验字段、类型、范围、条件必填、对象数组及 POST query/body；KOOK 迁移到该公共契约，Heychat 的 36 个官方动作按领域拆分并关闭任意参数透传。
- 7845f1c: 让 KOOK 与黑盒语音从单一不可变注册表派生平台动作发现与执行。
- 83490a7: 统一由平台动作注册表派生不可变能力描述，保留各平台权限、上下文与场景差异，避免动作实现、Web 能力展示和支持动作查询发生漂移；微信公众号原生语言参数查询改用不与 canonical 动作冲突的 `get_wechat_user_info`。
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

## 4.0.7

### Patch Changes

- Updated dependencies [9cc0622]
- Updated dependencies [c9e876c]
- Updated dependencies [a87f07a]
- Updated dependencies [f1493f6]
- Updated dependencies [78c1e50]
- Updated dependencies [03cc74d]
  - onebots@1.2.8

## 4.0.6

### Patch Changes

- onebots@1.2.7

## 4.0.5

### Patch Changes

- Updated dependencies [7891a2e]
  - onebots@1.2.6

## 4.0.4

### Patch Changes

- Updated dependencies [41f4bcc]
  - onebots@1.2.5

## 4.0.3

### Patch Changes

- Updated dependencies [f472ebf]
  - onebots@1.2.4

## 4.0.2

### Patch Changes

- Updated dependencies [1f79a8a]
  - onebots@1.2.3

## 4.0.1

### Patch Changes

- Updated dependencies [4fd55a6]
  - onebots@1.2.2

## 4.0.0

### Major Changes

- d9e67a0: feat(adapter-heychat): 新增黑盒语音官方机器人适配器
  - WebSocket 长连接、心跳与自动重连
  - 斜杠命令 (type=50) 与普通频道消息 (type=5，实验性)
  - 频道消息发送/删除与房间信息查询

### Patch Changes

- Updated dependencies [0519d6d]
- Updated dependencies [d9e67a0]
- Updated dependencies [fa90690]
  - onebots@1.2.1

## 3.0.0

### Major Changes

- feat: 黑盒语音 (Heychat) 官方机器人适配器首次发布
  - WebSocket 长连接、ConnectionManager 自动重连与心跳
  - 斜杠命令 (type=50) 与普通频道消息 (type=5，实验性)
  - 频道消息发送/删除与房间信息查询
  - 统一 ID 映射（resolveId）与 core 代理工具
