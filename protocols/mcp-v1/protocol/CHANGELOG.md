# @onebots/protocol-mcp-v1

## 0.1.15

### Patch Changes

- Updated dependencies [cf86bc0]
  - onebots@1.2.18

## 0.1.14

### Patch Changes

- Updated dependencies [09a1770]
- Updated dependencies [09a1770]
- Updated dependencies [09a1770]
  - onebots@1.2.17

## 0.1.13

### Patch Changes

- Updated dependencies [ec79a17]
  - onebots@1.2.16

## 0.1.12

### Patch Changes

- abe58b0: 为在线账号增加独立控制页，按平台能力展示好友、群、频道、成员与详情，支持纯文本发送和会话历史；无服务器目录的平台可直接查看频道，direct 私聊沿用平台原生发送场景。会话草稿与待确认发送互不串联，未知发送只阻止原会话；在本次浏览器会话中仅保存操作 ID 以供返回后查询，不保存消息正文。页面提供新消息提示、内联确认及历史设置入口；窄屏按列表与聊天分屏切换，中宽度可滚动查看详情，并保持键盘焦点与聊天阅读位置。历史、列表和成员读取错误分别显示就地重试，切换账号时清除旧会话状态，更早消息分页失败后按原请求重试。管理服务与网关共用仅保存规范化文本的 SQLite 历史，默认保留 30 天，可在系统设置中调整、关闭或手动清理。协议发送路径统一发布成功发送事件，以便保存来自 Web 及协议客户端的发出消息。补齐 Twitch 的频道和私聊发送能力声明。

  多人 direct 入站消息以独立会话 ID 保存，避免混入发言人的一对一历史。

  统一消息事件可携带规范化会话 ID，适配器发送回执可声明已确认的会话身份；Slack、Zulip、Matrix、Google Chat、QQ 与邮件据此对齐 direct 收发历史。一对一好友历史仍按 private 查询，不把适配器发送场景误当成历史场景。

  控制页新增按账号列出并分页读取的最近会话，直接打开已保存的多人直聊、私聊、群和频道历史；发送能力按真实场景单独声明，避免把支持私聊误认为支持多人直聊。

  相同目标 ID 的一对一与多人直聊拥有独立列表键及阅读位置；更早消息请求晚返回时不会移动新会话的滚动位置。

  多人直聊没有可用详情时不再占据空白侧栏；窄屏列表保持足够的阅读高度。

  手机会话页将详情与成员收进按需打开的底部浮层，关闭后返回详情入口，避免长列表挤占聊天与输入空间。

  手机联系人列表将低频的按 ID 打开输入移入底部浮层，桌面仍保留就地表单。跨越手机与桌面断点时会关闭已打开的浮层，避免隐藏对话框继续锁住页面。

  手动打开会话时对空白 ID 就地提示并保持输入焦点；手机浮层不自动弹出键盘，详情中的长成员标识不会撑宽页面。

  直达控制页首次读取状态时展示加载态，读取失败时展示错误与重试，不再误报账号离线。

  控制页的历史设置入口现在准确跳转到系统中的聊天记录设置，而不是通知投递记录。

  最近会话刷新会同步重试账号发送能力读取；会话详情读取失败时可在原会话就地重试，不打断已加载的聊天记录。

  手机聊天页在发送能力未确认时直接提供“重新确认”，成功后聚焦消息输入框；列表与消息刷新期间保留按钮焦点，详情或成员重试成功后将焦点移到对应结果。

  修正 direct 会话待确认发送的浏览器恢复校验，避免刷新页面后丢失原操作 ID 并诱发重复发送。

  发送结果未知时焦点转到原操作查询按钮，查询成功后返回消息输入框；异步交互只对未切换的会话移动焦点，并保持重复提交保护。

  手机聊天页将刷新、历史设置和群/频道详情统一收进“会话操作”底部浮层，收紧会话头部与输入区占用；桌面仍保留原位操作。

  手机聊天页读取历史失败时，错误提示独占会话头部的一行，不挤出会话名和操作入口；详情与成员重试仅在成功完成后移动焦点，失败或切换会话时保留当前焦点。

  刷新当前服务器的频道列表不再清除已选频道和聊天记录；刷新失败保留上次列表，在刷新期间打开频道也不会让列表永久停留在加载中。

  聊天历史重试期间保留错误提示与按钮焦点，阻止重复重试；成功后将焦点移到当前会话标题，失败则保留重试入口。

  手机打开群或频道时暂不预取成员，首次打开详情浮层才按需读取；重复打开复用结果，切换到桌面侧栏时会补读尚未加载的成员。

  聊天区按每次会话选择隔离更早消息的滚动补偿；旧会话分页未结束时不会压制新会话的新消息提示，当前会话分页期间到达的新消息也会提示查看。

  账号目录投影会清理平台名称、备注等展示字段中的控制字符，跳过无法安全表示的 ID，并按控制响应大小限制截断长列表，避免单条异常资料导致整张列表不可用。

  短屏手机与中宽度平板的聊天区按剩余视口高度收缩，优先让消息输入和发送按钮留在首屏；平板群/频道详情移到下方时真正释放第三栏宽度，避免聊天区被不可见空栏挤窄。

  最新历史页不足一页时以服务器结果替换本地记录，避免手动清理或保留期过期后继续显示已删除消息；满页刷新保留已翻阅的更早消息，同时移除与最新页重叠范围内不再存在的记录。

  聊天历史响应增加持久化修订号：清理或保留期删除会使所有已翻阅的旧页失效，普通新消息则不会打断阅读；旧页请求遇到修订号变化时重新读取最新页，而不沿用过期游标或滚动补偿。

  历史恰在旧页加载期间被清理时，聊天区会回到新历史底部并清除误导性的“新消息”提示；会话已切换时仍不会移动另一段会话的阅读位置。

  历史修订号变化时同步刷新最近会话，并忽略清理前仍在途的旧列表响应，避免已删除的会话短暂重现。手机联系人列表将分类切换移到按需打开的底部浮层，收起常驻标签栏，保留桌面快捷分类与刷新操作。

  手机从聊天返回联系人列表时将焦点放回列表区域，不再自动聚焦搜索框并弹出软键盘；桌面仍保持返回后可直接搜索。

  浏览器刷新后恢复的待确认发送在查询成功时会立即刷新当前会话历史；操作仍只保存 ID，不保存消息正文。

  手机聊天输入框与发送按钮并排，减少固定输入区占用；发送能力与错误状态仍保持独立展示。

  手机账号卡片保留在线控制入口与状态，将编辑、删除收进按账号打开的底部操作浮层，避免操作按钮挤占卡片内容。

  会话详情的并发重试按请求代次结算，较早失败不会覆盖已成功的最新详情或重新点亮错误提示。

  管理状态读取失败时不再把旧的在线快照当作发送授权：控制页标注状态待确认并暂停新发送，同时保留已加载的会话、历史和草稿，状态恢复后可继续。

  控制页不再把 direct 能力猜作按用户 ID 私聊。适配器显式声明 private 可发送场景；Matrix、Google Chat 等仅支持空间或房间 ID 的平台不再误开放好友发送，用户定址的一对一平台仍可按 private 发送。

  网关发送执行器与控制页共用场景能力判定，管理接口直接调用也不能绕过适配器当前账号的发送场景声明；动态能力读取失败时拒绝新发送。

  桌面分类栏内直接提供刷新，不再重复显示分类标题与第二行按钮；手机保留单行分类入口和刷新。

  “新消息”跳转遵循系统减少动态效果设置；平滑滚动被打断时保留提示，直到实际到达最新消息附近。

  同一会话的详情能力变为不支持时清除旧详情，退回列表基本资料，避免继续展示过期资料。

  平台未提供详细资料时，桌面侧栏和手机会话浮层均明确标注当前只显示列表基本信息。

  历史消息若含异常或越界时间戳，仅该条显示“时间未知”，不再让整个聊天页渲染失败。

  Matrix 事件缺少平台时间及通用消息的非正时间改用接收时间，避免新消息被聊天记录保留期误判为 1970 年记录而直接过滤。

  手机联系人与聊天区按剩余视口高度伸展，减少常规手机首屏底部的空白，仍允许短屏滚动使用。

  手机聊天中可直接打开会话列表底部抽屉切换目标，无需先退出当前会话；关闭抽屉或重新选择原会话会保留聊天内容与未发送草稿。分类选择继续使用独立弹层，Esc 按层级返回。

  管理状态读取失败与普通操作失败分别跟踪：只有前者使账号控制页暂停发送并标记状态待确认；控制页就地呈现状态故障时不再重复占用全局告警条。

- abe58b0: 修复 Windows 原生 Shell 下的构建清理命令，补齐文档站安装脚本产物，并明确 Windows 前台管理端的配对方式。
- Updated dependencies [abe58b0]
- Updated dependencies [d6ea4d3]
- Updated dependencies [abe58b0]
- Updated dependencies [abe58b0]
- Updated dependencies [abe58b0]
- Updated dependencies [abe58b0]
- Updated dependencies [abe58b0]
- Updated dependencies [abe58b0]
  - onebots@1.2.15

## 0.1.11

### Patch Changes

- Updated dependencies [12f6492]
  - onebots@1.2.14

## 0.1.10

### Patch Changes

- 117e738: 将 MCP stdio 命令迁移到管理服务：通过私有控制连接使用当前网关的已配置账号，以设备会话和网关实例隔离连接；网关停止或重启后关闭旧会话，不重放工具调用。删除命令自行启动账号的旧实现，兼容标准初始化通知并补齐有界事件推送。
- ae7b21b: 协议默认配置改用独立运行时注册入口，保持现有默认值和配置类型不变。
- 679a543: 重新发布协议运行工件，使其只依赖新的独立网关宿主接口，并与移除旧 `App` 导出的 `onebots` patch 版本共同安装。
- Updated dependencies [a366a8e]
- Updated dependencies [dbd49da]
- Updated dependencies [4763996]
- Updated dependencies [e17cb29]
- Updated dependencies [e734ce9]
- Updated dependencies [72b41d3]
- Updated dependencies [39a61cf]
- Updated dependencies [b9725f7]
- Updated dependencies [ff8edaa]
- Updated dependencies [36e1b3e]
- Updated dependencies [b4c7fd2]
- Updated dependencies [e88603c]
- Updated dependencies [3a280a2]
- Updated dependencies [ced4d13]
- Updated dependencies [962dc1c]
- Updated dependencies [e25d352]
- Updated dependencies [d5e9665]
- Updated dependencies [5d6d21c]
- Updated dependencies [b6c04ed]
- Updated dependencies [5f28177]
- Updated dependencies [b51a188]
- Updated dependencies [d5d5232]
- Updated dependencies [4e53609]
- Updated dependencies [a2d87f6]
- Updated dependencies [f55f927]
- Updated dependencies [81b4b3b]
- Updated dependencies [682c5f6]
- Updated dependencies [a4c66da]
- Updated dependencies [0f5819c]
- Updated dependencies [0e093b5]
- Updated dependencies [c5cea4c]
- Updated dependencies [0f5ec70]
- Updated dependencies [b46b52b]
- Updated dependencies [70a50e2]
- Updated dependencies [6235116]
- Updated dependencies [8e45c8c]
- Updated dependencies [7dfbcae]
- Updated dependencies [32cae35]
- Updated dependencies [4cad3ee]
- Updated dependencies [d5b2bd7]
- Updated dependencies [3e1c734]
- Updated dependencies [682c5f6]
- Updated dependencies [83e2d37]
- Updated dependencies [6235116]
- Updated dependencies [f8a1900]
- Updated dependencies [b57d223]
- Updated dependencies [6b014e7]
- Updated dependencies [c19f0ec]
- Updated dependencies [efae7f7]
- Updated dependencies [e6a651e]
- Updated dependencies [f7268c9]
- Updated dependencies [cc0ad2e]
- Updated dependencies [c109164]
- Updated dependencies [7058741]
- Updated dependencies [2eda015]
- Updated dependencies [4a3f970]
- Updated dependencies [4d09bd4]
- Updated dependencies [ac65da1]
- Updated dependencies [63b98ad]
- Updated dependencies [0d81eb1]
- Updated dependencies [11a16b6]
- Updated dependencies [5273d5b]
- Updated dependencies [1ad8697]
- Updated dependencies [1246167]
- Updated dependencies [117e738]
- Updated dependencies [ddf2ce7]
- Updated dependencies [a5470e3]
- Updated dependencies [ef8a16a]
- Updated dependencies [75acffc]
- Updated dependencies [efe89b8]
- Updated dependencies [fcb6bda]
- Updated dependencies [f449078]
- Updated dependencies [3a6d818]
- Updated dependencies [5f95423]
- Updated dependencies [3ef2593]
- Updated dependencies [69176d6]
- Updated dependencies [08f5a43]
- Updated dependencies [0cd6827]
- Updated dependencies [6264429]
- Updated dependencies [2889519]
- Updated dependencies [8e7732f]
- Updated dependencies [0f999aa]
- Updated dependencies [ef2fd01]
- Updated dependencies [a863529]
- Updated dependencies [fd04480]
- Updated dependencies [1fee4fe]
- Updated dependencies [5b4b76f]
- Updated dependencies [ef8a16a]
- Updated dependencies [af780a1]
- Updated dependencies [9ff6af8]
- Updated dependencies [d705d59]
- Updated dependencies [c36338f]
- Updated dependencies [57c764a]
- Updated dependencies [30ece7d]
- Updated dependencies [2789703]
- Updated dependencies [21c6bba]
- Updated dependencies [31e3c60]
- Updated dependencies [c75dee1]
- Updated dependencies [f5faede]
- Updated dependencies [0e37065]
- Updated dependencies [7c6a999]
- Updated dependencies [716ad9b]
- Updated dependencies [c53449a]
- Updated dependencies [4923c70]
- Updated dependencies [eda9bf8]
- Updated dependencies [b186161]
- Updated dependencies [b9a0757]
- Updated dependencies [e337a36]
- Updated dependencies [2a31468]
- Updated dependencies [425515a]
- Updated dependencies [391564d]
- Updated dependencies [7549fe2]
- Updated dependencies [ae8c26b]
- Updated dependencies [11881f2]
- Updated dependencies [513acd7]
- Updated dependencies [0d81eb1]
- Updated dependencies [9ca4489]
- Updated dependencies [ae7b21b]
- Updated dependencies [11c0ae1]
- Updated dependencies [2279385]
- Updated dependencies [2f16cb9]
- Updated dependencies [5f12c34]
- Updated dependencies [251534d]
- Updated dependencies [4aeb871]
- Updated dependencies [fe623c6]
- Updated dependencies [f7bd842]
- Updated dependencies [283fb75]
- Updated dependencies [68497bf]
- Updated dependencies [c9b3659]
- Updated dependencies [77c090b]
- Updated dependencies [3393e10]
- Updated dependencies [d2aeedc]
- Updated dependencies [7c6a999]
- Updated dependencies [5c6e0f8]
- Updated dependencies [5f12f85]
- Updated dependencies [5b0d8dd]
- Updated dependencies [0f2e203]
- Updated dependencies [d3679c6]
- Updated dependencies [ea18435]
- Updated dependencies [bc4bfd2]
- Updated dependencies [4d2e62b]
- Updated dependencies [e15453c]
- Updated dependencies [6b3436b]
- Updated dependencies [3db58f5]
- Updated dependencies [f805e25]
- Updated dependencies [e2a148e]
- Updated dependencies [1aa95d1]
- Updated dependencies [431f274]
- Updated dependencies [3001293]
- Updated dependencies [3001293]
- Updated dependencies [f500a2b]
- Updated dependencies [7107ce0]
- Updated dependencies [95aff5c]
- Updated dependencies [431f274]
  - onebots@1.2.13

## 0.1.9

### Patch Changes

- onebots@1.2.12

## 0.1.8

### Patch Changes

- Updated dependencies [80600ef]
- Updated dependencies [a02ada0]
- Updated dependencies [ba672b9]
- Updated dependencies [e3eb81b]
- Updated dependencies [d449626]
- Updated dependencies [7f70d7a]
  - onebots@1.2.11

## 0.1.7

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

## 0.1.6

### Patch Changes

- 8903cca: 增加统一 Guild、Channel、Role 与 Emoji 资源生命周期通知模型；完整投影 KOOK 官方资源及成员在线事件，并让 OneBot、Satori 与 MCP 保留对应资源、子类型和平台扩展。
- 85784a8: 收紧 npm 发布边界：TypeScript 包不再携带测试产物，Web 管理端只发布构建后的 `dist`。发布流水线会真实打包全部工作区包，拒绝测试、源码、`node_modules` 泄漏或缺失入口的 tarball。
- 543a02c: 统一协议与应用 fallback 配置的表单契约，补齐 OneBot、Milky、Satori、MCP 的分区和敏感凭据元数据，并在协议注册时拒绝残缺 Schema。
- 6015fd7: 让 MCP stdio 串行处理请求、将异步失败转换为 JSON-RPC 内部错误，并在输入关闭时等待队列后只清理一次。
- 1551f62: 为统一好友与群申请动作增加可选黑名单策略，完整透传 ICQQ 原生能力和 OneBot 11/MCP 入口，并让 MCP 布尔参数使用严格 JSON Schema 类型。
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

## 0.1.5

### Patch Changes

- c9e876c: 建立统一的 Adapter 能力清单与结构化能力错误，修复 Teams、Mock 和企业微信事件投递，并复用微信生态回调验签、解密与 XML 解析实现。
- 78c1e50: 统一 SDK 地址语义并移除隐式 OneBots 路由兼容逻辑；为协议 Schema 增加事件过滤器元数据，在 Web 配置页提供可增删的可视化规则编辑器与高级 JSON 模式。
- Updated dependencies [9cc0622]
- Updated dependencies [c9e876c]
- Updated dependencies [a87f07a]
- Updated dependencies [f1493f6]
- Updated dependencies [78c1e50]
- Updated dependencies [03cc74d]
  - onebots@1.2.8

## 0.1.4

### Patch Changes

- onebots@1.2.7

## 0.1.3

### Patch Changes

- Updated dependencies [7891a2e]
  - onebots@1.2.6

## 0.1.2

### Patch Changes

- 41f4bcc: 改进 Web 配置、日志与验证管理，补充 MCP 和协议格式测试，并收紧核心、适配器及协议实现的公开类型。四个客户端 SDK 的事件扩展字段和默认响应数据由 `any` 收紧为 `unknown`，调用方需先进行类型收窄。
- Updated dependencies [41f4bcc]
  - onebots@1.2.5

## 0.1.1

### Patch Changes

- f472ebf: 实现 MCP (Model Context Protocol) v1 协议（#217, #218）：

  **协议插件 `@onebots/protocol-mcp-v1`：**
  - JSON-RPC 2.0 协议核心，协议版本 2025-03-26
  - 双传输：HTTP/SSE + stdio
  - 32 个 MCP Tools 覆盖消息、好友、群组、频道、文件、系统全部 API
  - 工具白名单/黑名单过滤、Bearer Token 鉴权
  - 实时事件推送（消息 + 通知）

  **客户端 SDK `@onebots/mcp-client`：**
  - McpStdioClient — stdio 传输客户端（Cursor / Claude Code）
  - McpSseClient — SSE 传输客户端（Web / 远程）

  **CLI 命令：**
  - `onebots mcp --account platform/account_id` 以 stdio 模式启动 MCP 服务

- Updated dependencies [f472ebf]
  - onebots@1.2.4
