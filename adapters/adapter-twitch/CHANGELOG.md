# @onebots/adapter-twitch

## 0.1.7

### Patch Changes

- Updated dependencies [ec79a17]
  - onebots@1.2.16

## 0.1.6

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

- abe58b0: 在常驻管理服务增加独立的通知规则、持久投递与 Webhook、SMTP 邮件和 Bark 渠道；Web 管理台提供动态配置、测试和重试，并为平台连接中断增加明确事件上报。
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

## 0.1.5

### Patch Changes

- Updated dependencies [12f6492]
  - onebots@1.2.14

## 0.1.4

### Patch Changes

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

## 0.1.3

### Patch Changes

- onebots@1.2.12

## 0.1.2

### Patch Changes

- Updated dependencies [80600ef]
- Updated dependencies [a02ada0]
- Updated dependencies [ba672b9]
- Updated dependencies [e3eb81b]
- Updated dependencies [d449626]
- Updated dependencies [7f70d7a]
  - onebots@1.2.11

## 0.1.1

### Patch Changes

- ce480b1: 新增完整 Twitch Helix 与稳定 EventSub 适配器，支持主动 WebSocket、签名 Webhook、已有 HTTP Host、已有 socket 和 manual ingress，共享严格验证、可靠去重、动态能力及结构化配置表单；同时让通用 record-list 支持行内下拉与条件字段，并发布 Twitch 能力目录。
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
