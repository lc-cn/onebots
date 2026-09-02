# @onebots/adapter-kook

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

- a3ec0f6: 修正 KOOK 标准列表超过官方单页上限的问题，增加统一分页收集与异常响应校验，并为黑名单、静音闭麦、助力和服务器成员管理动作补齐严格官方参数契约。
- 8903cca: 增加统一 Guild、Channel、Role 与 Emoji 资源生命周期通知模型；完整投影 KOOK 官方资源及成员在线事件，并让 OneBot、Satori 与 MCP 保留对应资源、子类型和平台扩展。
- 1d27bd1: 让 KOOK 账号启动响应 OneBots 生命周期取消信号，中止身份与 Gateway 请求、关闭未完成握手并阻止迟到响应恢复账号状态；同时修正文档中的配置字段名。
- 1588520: 移除 KOOK 的 Group 重复投影，保留 canonical Guild/Channel 模型，并以明确平台动作公开离开 Guild、踢成员与修改昵称能力。
- 85784a8: 收紧 npm 发布边界：TypeScript 包不再携带测试产物，Web 管理端只发布构建后的 `dist`。发布流水线会真实打包全部工作区包，拒绝测试、源码、`node_modules` 泄漏或缺失入口的 tarball。
- 976eba5: 按官方作用域重构 KOOK 系统事件投影，修正私聊目标与服务器/频道身份混淆，补齐机器人服务器生命周期、语音频道成员与批量黑名单 canonical 事件；公开复数投影入口，统一原生 API 安全路径校验并完善状态身份。
- 66a5760: 闭合 KOOK 底层调用、媒体、OAuth、服务器表情与徽章动作参数，统一拒绝契约外顶层字段。
- e1d5678: 闭合平台动作类型：不可变动作集合保留精确联合类型并支持动态字符串收窄，所有适配器从包入口统一导出动作集合、执行器与动作类型。
- 71fdd97: 完成全平台适配器能力清单，统一声明原生、模拟、权限、场景、事件、消息段与传输能力，并在运行时校验已声明动作确有具体实现，避免管理端和协议层暴露虚假能力。
- a86ccda: 补齐适配器配置 Schema 的身份分区与敏感字段元数据，使 Web 表单稳定按语义组织账号配置，并以密码输入保护 token、secret 与加密密钥。
- 4ede123: 闭合 KOOK 邀请列表、创建、删除与受邀用户动作，并为声明式路由增加可复用的至少一项必填约束。
- c78c813: 按 KOOK 官方接口闭合频道与私信回应、消息置顶动作的必填字段、类型和未知参数边界。
- 1708dc7: 闭合 KOOK 频道与私信历史动作，并按官方 query/body 边界重构管道消息动作。
- 3fe2d5a: 按 KOOK 官方模板接口闭合列表、创建、更新与删除动作的字段、必填项、长度和枚举约束。
- f1a1a77: 闭合 KOOK 语音频道与机器人在线状态动作，并为声明式路由补充布尔值和字符串数组参数规则。
- d886a77: 按 KOOK 官方裸数组响应解析语音频道成员列表，修复将该接口误当作标准分页响应而导致真实调用崩溃的问题，并在适配器边界校验成员身份。
- 2ff49b3: 补齐 KOOK 好友目录、申请处理、删除、屏蔽与主动申请能力，严格校验官方响应；同时闭合并发启动，并修正 Card 编辑与消息置顶状态事件投影。
- 8fe6210: 重写 KOOK 官方机器人接入：统一 REST、Gateway 与 Webhook 事件链路，默认无限重连，补齐加密回调、完整系统事件投影、原生富媒体与 Card 编译、结构化 API 错误，以及回应、置顶、角色、权限、黑名单、静音、邀请、帖子和语音等平台扩展动作。
- 3296349: 修正 KOOK Gateway 与 Webhook 在业务事件投递前提前确认序号的问题，改为成功后提交，并在失败时保留可重投状态。
- ad2523d: 抽取 HTTP、本地文件、data URL 与 Base64 媒体来源的统一物化模块，并由 Discord 与 KOOK 共享。

  KOOK 发送图片、音频、视频和文件前会通过当前机器人上传素材，同时修正首次身份请求失败后账号无法自动恢复的问题。

- a950886: 统一保留频道事件的服务器与频道双层地址，修正 OneBot V12 和 Satori 的频道事件投影，并让 OneBot V12 发送使用独立的 `guild_id` 与 `channel_id`。
- 67f3117: 将私信会话、亲密度、服务器表情、游戏动态与帖子动作迁移到严格的声明式契约，校验官方必填字段、分页范围、枚举、条件必填和 one-of 约束，避免命名动作继续透传未知参数。
- 5f38dc5: 为 KOOK 服务器角色与频道权限命名动作增加可复用的官方参数契约，严格校验必填字段、枚举、整数范围和未知字段，并保留 `call_kook_api` 作为显式原生扩展入口。
- 91f0a7f: 让七个适配器复用 core 的包版本读取模块，删除各自重复的文件读取、JSON 解析与错误处理实现。
- 68c600e: 闭合 KOOK 启停代次与异步生命周期语义，停止时等待事件队列并在 socket 关闭失败后继续完成清理。
- 705a76a: 统一 KOOK Gateway、Webhook 与 REST 边界，修复 sn 乱序丢事件，增加结构化接入、限流调度、动态配置表单及更多原生平台动作。
- 27b4ff2: 让 KOOK Gateway、Webhook 与 manual 接入等待 canonical 事件和全部协议出口成功后再确认 `sn`，并发 Webhook 会合并相同序号，Gateway 则串行投递并在失败或 reconnect 时使旧队列失效。

  补齐消息模板创建、更新、删除，以及机器人加入、列出、离开和保活语音频道的平台动作；同步更新能力说明、Schema 提示、README 与回归测试。

- 67bdebd: 统一九个适配器的严格 TypeScript 契约，并收紧 Discord 成员、Slack 消息以及 LINE、Teams、Telegram 可空数据的运行时边界。
- a992d8e: 修正适配器能力清单的动态权限语义，并让飞书、KOOK 与 Slack 平台扩展动作完整接入统一能力契约，避免模块加载或查询支持动作时误报失败。
- 02f1f17: 新增可复用的声明式 HTTP 平台动作契约，统一校验字段、类型、范围、条件必填、对象数组及 POST query/body；KOOK 迁移到该公共契约，Heychat 的 36 个官方动作按领域拆分并关闭任意参数透传。
- 884cf2f: 严格校验 KOOK Gateway、Webhook、HELLO 与事件报文，移除数字字符串强转及缺失时间、ID 的本地填充，并公开独立的 challenge 与信令类型。
- 7e9dee2: 为 KOOK Gateway 握手超时与提前关闭提供稳定的结构化网络错误码和关闭上下文。
- a60ad81: 补齐 KOOK 用户 OAuth2 授权、换码、用户资料与用户服务器能力，并隔离 Bot Token、应用密钥和用户访问令牌。
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

## 3.0.8

### Patch Changes

- c9e876c: 建立统一的 Adapter 能力清单与结构化能力错误，修复 Teams、Mock 和企业微信事件投递，并复用微信生态回调验签、解密与 XML 解析实现。
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

- 4fd55a6: 登录验证与配置 Schema 体验修复：
  - 微信 ClawBot 二维码过期自动换码后推送到 Web 并更新 UI；登录成功清理待处理验证
  - ICQQ 将 `login_error` / `offline` 的 message 推送到验证面板，提供「重新登录」等快捷操作；扫码 / 身份验证 / 设备锁统一「已完成，继续登录」
  - `VerificationRequest` 新增 `actions`、`confirmLabel`，网关支持 `verification:clear`
  - 配置 Schema 彻底用 `choices` 替代 `enum`（含中文选项）；object 字段（如 `log_config`）留空不再默认写成 `{}`
  - 拦截 ICQQ SSO 心跳等未处理 Promise rejection，避免拖垮进程；网络闪断依赖自动重连、不误推重登；微信轮询瞬态网络错误降级为 warn

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

## 1.0.7

### Patch Changes

- b00497a: fix: 调整发布流程,做首次release
- Updated dependencies [b00497a]
  - onebots@1.0.7

## 1.0.6

### Patch Changes

- onebots@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [4465ece]
  - onebots@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [2645ccf]
  - onebots@1.0.4

## 1.0.3

### Patch Changes

- 5d3787b: fix: v1.0.1
- Updated dependencies [5d3787b]
  - onebots@1.0.3

## 1.0.2

### Patch Changes

- 78d4de2: fix: bump version
- Updated dependencies [78d4de2]
  - onebots@1.0.2

## 1.0.1

### Patch Changes

- 4f7255b: chore: 切换到 npm OIDC 可信发布
  - 移除 NPM_TOKEN 依赖
  - 使用 GitHub OIDC + Provenance 发布
  - 所有 25 个包已配置 Trusted Publishers

- Updated dependencies [4f7255b]
  - onebots@1.0.1

## 1.0.0

### Major Changes

- 57cf3ba: 🎉 OneBots v1.0.0 首次发布

  ## 核心包
  - **@onebots/core** - 核心抽象层，定义适配器、账号、事件等基础接口
  - **onebots** - 主应用包，提供机器人运行时和 HTTP 服务
  - **@onebots/web** - Web 管理界面
  - **imhelper** - 客户端 SDK 核心

  ## 平台适配器 (12+)

  | 适配器                    | 平台            | 描述                           |
  | ------------------------- | --------------- | ------------------------------ |
  | @onebots/adapter-qq       | QQ              | QQ 官方机器人 API              |
  | @onebots/adapter-icqq     | ICQQ            | 基于 @icqqjs/icqq 协议         |
  | @onebots/adapter-kook     | Kook            | Kook (开黑啦) 机器人           |
  | @onebots/adapter-wechat   | 微信            | 微信公众号                     |
  | @onebots/adapter-discord  | Discord         | 轻量级 Discord API 实现        |
  | @onebots/adapter-telegram | Telegram        | 基于 grammy 的 Telegram Bot    |
  | @onebots/adapter-feishu   | 飞书/Lark       | 飞书/Lark 机器人（可配置端点） |
  | @onebots/adapter-dingtalk | 钉钉            | 钉钉机器人                     |
  | @onebots/adapter-slack    | Slack           | Slack 机器人                   |
  | @onebots/adapter-wecom    | 企业微信        | 企业微信机器人                 |
  | @onebots/adapter-teams    | Microsoft Teams | MS Teams 机器人                |
  | @onebots/adapter-line     | Line            | Line Messaging API             |
  | @onebots/adapter-mock     | Mock            | 测试/开发用模拟适配器          |

  ## 协议实现 (服务端)

  | 协议包                       | 协议       | 描述                      |
  | ---------------------------- | ---------- | ------------------------- |
  | @onebots/protocol-satori-v1  | Satori v1  | Satori 协议服务端实现     |
  | @onebots/protocol-onebot-v11 | OneBot v11 | OneBot v11 协议服务端实现 |
  | @onebots/protocol-onebot-v12 | OneBot v12 | OneBot v12 协议服务端实现 |
  | @onebots/protocol-milky-v1   | Milky v1   | Milky 协议服务端实现      |

  ## 客户端 SDK

  | SDK 包               | 协议       | 描述                      |
  | -------------------- | ---------- | ------------------------- |
  | @imhelper/satori-v1  | Satori v1  | Satori 协议客户端 SDK     |
  | @imhelper/onebot-v11 | OneBot v11 | OneBot v11 协议客户端 SDK |
  | @imhelper/onebot-v12 | OneBot v12 | OneBot v12 协议客户端 SDK |
  | @imhelper/milky-v1   | Milky v1   | Milky 协议客户端 SDK      |

  ## 主要特性
  - 🎯 多平台支持 - 统一的 API 接口
  - 🔌 插件系统 - 灵活的中间件架构
  - 📡 多协议支持 - Satori、OneBot v11/v12、Milky
  - 🌐 Web 管理界面 - 可视化管理和监控
  - 🔒 代理支持 - Discord/Telegram 支持 HTTP/HTTPS 代理
  - ☁️ 部分 Serverless 支持 - 飞书、钉钉、QQ 等 Webhook 模式

### Patch Changes

- Updated dependencies [57cf3ba]
  - onebots@1.0.0
