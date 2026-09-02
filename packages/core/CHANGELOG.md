# @onebots/core

## 1.2.6

### Patch Changes

- 4fb5a8b: 让账号启动与停止生命周期等待异步监听器；启动失败阻止协议误启动，停止阶段完整尝试所有协议与客户端并汇总错误，避免提前成功和未处理拒绝。
- 6716778: Web 配置保存现在会串行执行原子写盘与运行时热重载：应用失败时恢复上一版本，并发保存返回冲突；宿主网络等不可热重载字段会明确提示需要重启，界面在整个应用过程禁用重复提交。
- d19d9a6: 配置创建与更新现在统一使用同目录原子替换：写入内容会先同步到临时文件，已有配置的上一版本保存在 `.bak`，并保留已有文件权限与符号链接部署。setup、管理端保存、自动凭据及运行时账号变更不再直接截断正式配置文件。
- a43a80e: 让应用停机与启动回滚等待安全审计日志刷新关闭，并把异步写入错误纳入可诊断的清理失败。
- b688f78: 让全局 `timeout` 真正约束账号登录监听器与协议出口启动，超时后中止协作式启动信号、保留失败状态，并继续尝试其他账号。
- 18ea42b: 为插件异步注册事务增加超时、回滚和迟到修改隔离，避免异常入口永久阻塞启动与诊断。
- 6638635: 为 WebSocket 路由提供显式入站消息上限，并将管理端主连接和交互终端分别限制为 4 MiB 与 1 MiB。
- 8903cca: 增加统一 Guild、Channel、Role 与 Emoji 资源生命周期通知模型；完整投影 KOOK 官方资源及成员在线事件，并让 OneBot、Satori 与 MCP 保留对应资源、子类型和平台扩展。
- caac8eb: 补齐 Milky 1.1 账号资料 API，并以通用 Adapter 能力闭合 ICQQ 的头像、昵称、个性签名和自定义表情实现。
- 47dec1e: 将管理端的插件默认选择从通用 JSON 输入升级为开放的列表编辑器：当前运行时已验证的插件会作为带包名和版本的建议，第三方插件仍可通过短名或完整包名自由添加。Schema 新增显式的开放选项列表契约，避免把运行时建议误作封闭白名单。
- 16baf4b: 让微信公众号 Webhook 与 manual 接入共享可靠异步投递和去重状态，改用稳定版 access token，并补齐 API 配额、RID、域名与回调 IP 诊断动作。
- fe109c2: 增加 Zulip 现代 narrow 消息标记、批量匹配与举报 API，抽离消息动作模块，并补齐 `update_message_flags` 精确事件类型和 canonical 投影。
- 650faf3: 持久化 setup 验证过的适配器与协议选择，并让前台启动、doctor、服务安装、更新和 MCP 模式在未显式传参时复用配置默认值。插件选择发生变化时现在会明确要求重启，避免运行态与磁盘配置不一致。
- f22eab6: 抽取与对象键顺序无关的 canonical JSON 指纹原语，统一多个适配器的事件回退身份；修复飞书事件缺少 `event_id` 时依赖接收时钟、导致重试事件获得不同 ID 的问题。
- 4fee4cb: 补齐 ICQQ 资料卡与 QQ 协议版本数据，并按 canonical Milky 契约输出完整用户与实现信息。
- a3a22b4: 新增成功后提交的有界事件去重原语，并统一 Slack、Telegram 与 Teams 的重投语义。完善 Teams 标准 Request 入站、真实机器人身份、原始 Activity 保留，以及 Activity 成员和 Azure Bot OAuth 平台动作。
- 4cef9d7: 重构 WhatsApp Cloud API 适配器：统一 snake_case 配置与共享 HTTP Webhook，增加原始请求验签、重复投递过滤、完整事件投影、多段消息、媒体与管理动作、通用 Graph API 客户端，并移除 axios 和私有监听配置。

  同时将 Adapter 工厂类型收敛到注册表真实使用的 BaseApp 构造约定，避免严格模式下合法适配器需要类型断言。

- c9c7a8f: 补齐 Zulip 附件列表、删除、临时 URL 和缩略图状态 API，默认订阅并投影附件增改删事件；同时拆分 Zulip Event Queue 协议类型，保持 REST 与事件模块边界清晰。
- aaa069d: 对齐 Milky canonical 文件 API 字段与完整群文件实体，并将 ICQQ 原生群文件元数据保真投影到协议响应。
- 347e73f: 将 Milky 好友请求列表与处理动作改为真实 QQ UID 语义，补齐目标用户、状态、来源与过滤字段，并把 ICQQ opaque flag 隔离在适配器内部。
- c30ac97: 将 Milky 群管理动作收敛为独立的 canonical 翻译层，修正头像、管理员、全员禁言、精华与消息表态字段，并让 ICQQ 和 Discord 正确执行表态的添加与删除。
- c2f2c32: 闭合 Milky 群通知的 canonical 联合类型、过滤与游标分页，并在处理群申请和邀请前校验通知序列、群号与请求类型。
- e03f801: 对齐 Milky canonical 消息查询、历史游标、合并转发与资源临时链接契约，并让 ICQQ 保真投影相关数据。
- 005e0b5: 统一媒体字节物化能力，并完善微信 ClawBot 的严格消息编译、事件校验及可取消连接生命周期。
- 85784a8: 收紧 npm 发布边界：TypeScript 包不再携带测试产物，Web 管理端只发布构建后的 `dist`。发布流水线会真实打包全部工作区包，拒绝测试、源码、`node_modules` 泄漏或缺失入口的 tarball。
- fda6496: 收紧 CLI 的可选 MCP stdio 模块、鉴权路由和 OneBot v11 自定义音乐段类型边界，集中 CLI 输出与 Web 客户端诊断出口；setup 仅从实际加载的协议生成默认配置，并清理会掩盖真实类型问题的宽泛断言和无效变量。
- 20744e5: 允许配置 Schema 根据已有兄弟字段推断缺失选择值，避免管理端编辑旧配置时覆盖或删除隐藏凭据。
- a5c1a35: 抽取微信生态共享 JS-SDK 签名内核，补齐企业微信网页授权、访问者身份、企业/应用 ticket 缓存与签名动作，并收紧可选动作参数类型。
- 3bf18f6: 统一反向 WebSocket 的无限重连与停止生命周期，避免协议停止后遗留连接或定时器重新拉起。

  修正 OneBot 11 仅配置反向 WebSocket 时不发送心跳的问题，并防止 OneBot 11、Milky 重连后丢失事件派发监听。

- 03e196a: 增加 canonical 用户组资源生命周期、成员与子组通知，默认订阅 Zulip 用户组事件并逐对象稳定投影，同时移除本地接收时间伪造。
- f4c648f: 让配置保存和账号增删改返回可验证的精确配置修订，并要求实例、操作、目标及响应头与正文共同证明提交结果。
- 4383e38: 在账号停止、删除、热重载或候选回滚时撤销其 HTTP 与 WebSocket 路由，避免旧处理器继续占用新账号的同名路径。
- c3d1cf4: 阻止插件在加载事务结束后继续异步修改扩展注册表。
- e1d5678: 闭合平台动作类型：不可变动作集合保留精确联合类型并支持动态字符串收窄，所有适配器从包入口统一导出动作集合、执行器与动作类型。
- 71fdd97: 完成全平台适配器能力清单，统一声明原生、模拟、权限、场景、事件、消息段与传输能力，并在运行时校验已声明动作确有具体实现，避免管理端和协议层暴露虚假能力。
- ef7d86b: 让平台动作参数契约支持领域子表组合，并统一微信公众号与微信 ClawBot 的命名动作校验实现。
- e69ebfc: 完善 Zulip 消息提醒查询、创建和删除的参数契约，补齐精确事件、默认订阅与 canonical 资源通知，并抽取个人资源事件模块。
- 9e70080: 新增完整清理流程的失败收集器，并让账号停止复用统一的单错误与聚合错误传播语义。
- a13c7e0: 新增跨代有序事件投递队列，为无法提供异步背压的事件源统一提供顺序、持续退避重试、停止取消与积压观测语义。
- 5d0ee5f: 新增不可变平台动作注册表，并让首批适配器从单一 handler 表派生能力发现与执行。
- 86ab690: 为配置 Schema 增加声明式条件显示，Web 表单会动态隐藏并清理非当前模式字段；Discord Intents 与 Telegram Update 订阅改为可增减选项，并统一 Telegram polling/webhook 接收计划及运行时校验。
- 44de2fd: 在适配器 Schema 注册边界强制校验表单分区、动态显示依赖、组件类型与敏感凭据元数据，使新增和第三方适配器无法静默退化为不安全、难维护的通用表单。
- 543a02c: 统一协议与应用 fallback 配置的表单契约，补齐 OneBot、Milky、Satori、MCP 的分区和敏感凭据元数据，并在协议注册时拒绝残缺 Schema。
- 0fd3b1b: 扩展 ICQQ 原生消息、好友、群管理、QQ 频道、文件与凭据能力，并通过 Milky、OneBot 11 和 OneBot 12 接通可准确表达的协议动作；修复群申请 opaque 标识往返与严格布尔参数校验。
- e4a2c30: 为 readiness 增加明确的运行态操作类型，并让 doctor、Web 与 Prometheus 区分完整配置重载、账号配置事务和手动上下线。
- cef5489: 显式发布适配器的账号生命周期控制能力，并让管理端上线、下线操作在目标缺失或插件未实现时返回可验证的失败结果。
- 31a5f8d: 通过 Prometheus 直接公开精确就绪结论与互斥配置状态。
- fe08d63: 让 `deepClone` 在无法生成独立副本时失败关闭，并在应用初始化、热重载、协议配置继承与账号编辑前克隆合并来源，避免运行配置与调用方对象共享引用。
- e03f801: 补齐好友性别与分组资料，修正 ICQQ 好友详情错误降级为陌生人资料的问题，并按 canonical Milky FriendEntity 统一投影。
- 41199e5: 补齐通用群与群成员资料契约，保真传递 ICQQ 的创建时间、等级、身份、入群时间、最后发言、头衔与禁言信息，并按 canonical Milky 实体严格投影。
- 27b72e3: 适配器与协议元数据改为不可变快照，协议版本列表通过 copy-on-write 更新，防止插件加载后篡改其他扩展的展示信息或版本证据。
- 5ebc795: 配置 Schema 注册时改为保存不可变快照，防止插件在预检后改写自身或其他扩展的配置契约；容器默认值在每次校验时独立复制，避免冻结对象进入运行配置。
- b67d335: 完善 Zulip 定时消息查询、创建、编辑和删除的现代参数契约，并补齐精确事件类型、默认订阅与 canonical 资源通知。
- 42b8ade: 禁止第三方账号工厂在候选实例通过宿主验证前修改 Adapter 账号集合，并在越界时恢复原运行态。
- 1a5dbb7: 以可复用且具所有权保护的运行态租约统一配置重载、账号配置与手动上下线，确保同步前置失败也会恢复 readiness。
- ab9e08f: 让 `deepMerge` 只合并可枚举自有字段，并在写入前拒绝嵌套的原型链保留名称，避免外部配置改变结果对象原型或留下部分合并状态。
- 4c27657: 限制对象路径工具只遍历自有属性，并拒绝空路径段与原型链保留名称，避免第三方扩展处理动态路径时访问或修改对象原型链。
- 0f4acc0: 约束相对静态目录的实际路径，并以不跟随符号链接的原子写入管理上传文件，避免静态文件操作越出配置目录。
- 783051c: 在适配器实例创建时校验注册能力清单与运行时默认清单一致，并提前拒绝缺少具体实现的已声明动作，避免扩展中心与账号运行态展示相互矛盾的能力。
- c2bbba4: 为通用事件模型增加明确的消息状态通知，并让 WhatsApp 区分消息状态与内容编辑、修正自定义事件时间戳、收紧 Graph API 资源路径，同时仅从真实 Webhook 联系人资料回答用户查询。
- 7f0d5c8: 让 `/ready` 声明当前 OneBots 应用、版本和进程实例身份，并让 Web、doctor、status 与官方容器探针拒绝无法归属到具体 OneBots 实例的就绪响应。
- 1615e73: 隔离同一适配器下各账号的启动失败，继续尝试后续账号并保留带账号身份的完整故障证据。
- a5e99c0: 隔离每个 BaseApp 的 HTTP 性能指标与过期数据清理边界。
- a5c4f96: 让协议、账号、适配器与生命周期钩子的停止失败彼此隔离，并在数据库、网络、安全审计和 close 监听器均获得清理机会后统一汇总错误。
- 1a65be7: 隔离 Adapter 与 Protocol 实例工厂对全局扩展注册表的副作用，并在越界时恢复原注册状态。
- 34b2d31: 隔离应用与管理认证限流预算，为失败登录提供重试提示，并安全保存自定义限流键。
- 3f5df08: 隔离应用会话管理器，并保留访问令牌过期后的有效刷新窗口。
- 046e50e: 应用实例现在会固化自己的配置、数据与日志路径，避免后创建的实例改写静态兼容默认值后导致已有实例跨目录读写。
- df5bd43: 隔离嵌入式应用的安全审计写入器与生命周期。
- 0de01b3: 禁止缓存健康、就绪与指标响应，并让 CLI 和终端仪表盘始终从规范网关路径读取当前实例探针。
- 59300db: 为 WebSocket 路由提供升级前连接上限，并限制管理主连接和交互终端的聚合连接数。
- 27c86a3: 让账号新增、编辑和删除共享原子运行态与配置文件事务，失败时恢复旧账号、内存配置和磁盘内容，并以 HTTP 409 拒绝并发配置变更。
- d35ccbc: 让配置热重载严格传播适配器、账号和协议的异步启动失败，并在失败后恢复旧运行态或同时报告回滚错误。
- 072b9c8: 为 Slack 补齐真实 Socket Mode、Webhook 原始请求签名校验、无损 Events API 投影、频道与消息等原生扩展动作，并为通用 Webhook 验签保留原始请求体。
- f6661b0: 新增能力清单白名单保护的平台扩展动作调用链，并让四种协议可调用适配器声明的扩展动作。Telegram 适配器补齐群管理、入群申请、文件、投票、转发、Reaction、置顶和邀请链接等原生能力，将完整 Update 统一投影且保留 raw_event。
- 74bbc4b: 收紧 Zulip Presence、话题可见性和输入状态的现代参数契约，增加消息编辑输入状态，并补齐精确事件与 canonical 通知。
- ae6dbf5: 拆分 Adapter 的默认动作契约与核心生命周期实现，保持统一动作调用和能力校验语义不变。
- ad2523d: 抽取 HTTP、本地文件、data URL 与 Base64 媒体来源的统一物化模块，并由 Discord 与 KOOK 共享。

  KOOK 发送图片、音频、视频和文件前会通过当前机器人上传素材，同时修正首次身份请求失败后账号无法自动恢复的问题。

- 1551f62: 为统一好友与群申请动作增加可选黑名单策略，完整透传 ICQQ 原生能力和 OneBot 11/MCP 入口，并让 MCP 布尔参数使用严格 JSON Schema 类型。
- 14b06b0: 收紧 Zulip 频道订阅与资料更新的现代参数契约，补齐批量订阅更新，并将频道生命周期和订阅关系事件投影为精确的 canonical 通知。
- 3be2e2e: 通过固定 Prometheus 标签公开管理 WebSocket 的连接占用、容量和满载拒绝计数。
- 2f0123f: 为 Adapter 工厂注册的 HTTP 与 WebSocket 路由建立候选回滚和生命周期所有权，避免无效或旧实例留下可达入口。
- a950886: 统一保留频道事件的服务器与频道双层地址，修正 OneBot V12 和 Satori 的频道事件投影，并让 OneBot V12 发送使用独立的 `guild_id` 与 `channel_id`。
- 5be37b3: 让前台运行完整保留 `-c` 指定的配置文件名，使管理、热重载、扩展与配置写回始终操作启动时选择的同一文件。
- 2e2d50d: 将远程 canonical 路由限制在正式 Adapter 动作面，显式修复 `get_supported_actions` 调用，并拒绝会被 canonical 路由遮蔽的平台扩展动作。移除 HeyChat 频道管理与 LINE 退群动作的重复注册；这些能力继续通过对应 canonical 动作提供。
- 94c6fc6: 把账号启动取消信号传入长连接工厂，并让 Discord、LINE、Slack 与 Telegram 在超时后停止未完成连接或忽略迟到的上线结果。
- 486bb90: 为账号配置事务增加磁盘漂移检测与安全回滚，避免登录期间覆盖外部更新。
- 24795c5: 允许适配器按账号抬高完整启动事务的保护窗口，并在账号摘要中公开最终生效值。

  微信 ClawBot 现在会保留默认 480 秒扫码窗口，同时响应账号启动取消信号，避免被全局 30 秒默认值提前中断。

- 860d03c: 根管理与终端 WebSocket 现在会在协议升级前执行与 HTTP 管理 API 一致的动态 token 鉴权，未授权请求返回 HTTP 401。热重载管理凭据后会撤销全部会话与刷新令牌并关闭既有管理连接，避免旧凭据继续读取配置或执行控制动作。
- 519df30: 固定健康检查、就绪探针和 Prometheus 指标的不可转换响应头，并显式声明指标文本格式。
- ff518fc: 收紧扩展注册表回滚快照的所有权，拒绝插件改写、伪造或重复恢复宿主状态。
- 8980ee8: 闭合 Web 重启请求的实例身份链。管理端现在携带预探测到的实例身份，服务端在预检前拒绝已被其他进程接管的过期请求，并返回应用、实例与调度状态；Web 只有验证完整回执后才等待新实例上线。
- 496f111: 分离在线主程序与 Core 版本身份：健康端点、Prometheus、系统信息和 Web 分别展示实际 `onebots` 与 `@onebots/core` 版本；doctor 会对比在线主程序与当前 CLI，版本漂移在严格模式下阻止部署。
- 92b2d8a: 完善 Zulip 保存片段查询、创建、编辑和删除的严格参数契约，并补齐精确事件、默认订阅与 canonical 资源生命周期通知。
- 6977687: 将指标、速率限制和令牌清理定时器标记为不保持进程存活，使 `doctor` 等只读短命令在完成后可以自然退出，同时不影响网关运行期间的周期清理。
- febbf02: 为健康探针增加脱敏的运行契约标识，并要求受管服务上线验证证明配置、插件与运行入口一致。
- 58cbc7b: 为协议实例增加由账号编排维护的生命周期状态，并让 `/ready`、Prometheus 指标与 `onebots doctor` 同时验证协议出口是否真正启动；空配置保持管理面可访问，但显式报告 `configured: false`。
- 78e2b18: 就绪检查现在要求每个已配置账号至少拥有一个协议出口；`/ready`、Prometheus 指标与 doctor 会直接报告缺少协议出口的账号数量，避免平台连接在线但无法向下游交付事件时被误判为可服务。
- 2b9c998: 移除安全审计与令牌生命周期日志中的明文 token 前缀，改用仅当前进程可关联的带密钥指纹。
- 7953c9a: 共享 Router 现在会拒绝重复的 HTTP 方法与精确路径，并在数组路径中的任一项冲突时原子撤销整次注册，避免后注册账号或扩展显示可用却始终无法收到回调。
- 2a0016a: 新增可复用的 `ReliableEventIngress`，统一事件并发合并、成功后提交和失败重投语义，并让 Teams、飞书与钉钉删除各自重复的投递状态机。

  让 LINE Webhook、`ingestHttp()` 与 manual `ingest()` 等待异步监听器和全部协议出口；投递失败不提交持久化去重状态，并发重投只执行一次且准确报告 duplicate。同步更新类型、Schema 提示、能力说明、README 与回归测试。

- f149bab: 配置热重载期间让 readiness 返回不可用并暴露重载指标，同时拒绝并发重载，避免编排系统向尚未完成切换的账号与协议出口转发流量。
- 3b3c3a1: 新增统一的包版本读取工具，并让 Discord、飞书/Lark、Slack 与 Telegram 的版本接口返回实际发布版本，不再固定报告 `1.0.0`。
- 1faf73d: 让主应用与优雅停机在尝试全部生命周期清理步骤后传播数据库、Router、HTTP 及扩展资源的释放失败，同时保留嵌入式调用默认的尽力清理兼容行为。
- 38eb759: 账号作用域内的 HTTP 与 WebSocket 路由冲突现在会同时报告正在注册和已占用路径的平台与账号，热重载失败时也会保留这些诊断并恢复旧账号路由。
- 3941b1d: 恢复并规范化宿主 `path` 的 HTTP Router 前缀，使运行时路由、状态检查与 doctor 使用同一部署地址，同时拒绝不安全的路径值。
- 1f60104: 插件加载现在以串行注册事务执行。初始化抛错或未满足工厂与 Schema 契约时，会恢复导入前的适配器、协议、Schema 和协议版本元数据，避免失败插件污染后续启动、doctor 与服务预检。
- 61e5c69: 启动任一阶段失败时执行完整资源回滚并废弃半初始化实例；主应用同时释放日志文件监听、进程退出监听和标准输出拦截，回滚失败时保留启动与清理两类错误。
- 5de897a: 记录进程最近成功应用的配置文件快照，在管理 API、Web 系统页和 doctor 中检测磁盘配置尚未重载或重启的漂移状态。
- 0ca53d8: 收紧适配器与协议注册表的唯一性契约：相同实现重复注册保持幂等，不同实现占用同一标识时立即报错；注销扩展时同步清理配置 Schema，避免实现、元数据与校验规则发生漂移。
- 4a55c2a: 让 SQLite 以仅所有者可访问的权限创建目录和数据库，并让 doctor 独立验证数据库文件及实际父目录的权限边界。
- 0141cea: 抽取代次安全的异步凭证缓存、有序受控并发与统一 API 路径校验，供多个适配器复用；企业微信与微信客服不再因旧请求的迟到错误清空新 token，并拒绝路径内嵌 query/fragment，同时将企业微信菜单与模板卡片回调投影为统一交互事件。
- 9665836: 按 Telegram `allowed_updates` 与 Zulip `event_types` 展示账号真正可达的事件能力，并提供可复用的账号事件能力收窄工具。
- 335375b: 修复应用热重载清理宿主资源、重复注册路由与账号启动未等待的问题，并拆分可观测性和静态目录模块。
- bacfbc7: 新增可等待全部协议完成的 `Account.dispatchAwaited()`，协议广播会尝试并等待全部投递出口，反向 HTTP/Webhook 失败可反馈给可靠事件入口；钉钉与飞书统一等待异步监听器、合并并发重投，并仅在协议投递成功后确认和提交去重状态。钉钉与飞书缺少原生事件 ID 时改用确定性载荷身份。
- 2b2361b: 强化 Mock 适配器的 typed 事件入口、确定性事件生成、结构化错误和消息方向隔离，并为配置 Schema 与 Web 管理端增加通用动态记录列表组件。
- 866c32d: 为统一事件增加好友移除通知，并让微信公众号准确投影关注关系、菜单交互与消息状态；同时为关注者目录增加分页去重与停滞游标保护，收紧通用 API 路径，避免迟到的旧 token 错误清空已经刷新的访问令牌。
- dca581b: 重构企业微信自建应用适配器：严格接入官方加密回调与应用群聊语义，补齐统一客户端、原生动作、消息编译、结构化错误、事件保真、Schema、文档和测试；同时让通用配置 Schema 可声明顶层敏感字段，并在 Web 表单中使用密码输入。
- 7506409: 重构 Zulip 适配器：改用官方 Event Queue 长轮询与原生 HTTP 客户端，补齐可靠重连、结构化错误、可嵌入 Client、原始事件入口、频道话题、真实订阅成员、文件上传、事件投影和平台扩展动作；同时抽取可复用的动态选项列表表单，完善 Schema 与中英文文档。
- a992d8e: 修正适配器能力清单的动态权限语义，并让飞书、KOOK 与 Slack 平台扩展动作完整接入统一能力契约，避免模块加载或查询支持动作时误报失败。
- e801d8e: 在适配器注册和实例化边界完整校验能力清单，并保存不可变快照，防止第三方插件发布畸形或可变的能力元数据。
- 34cccc4: 就绪端点与 Prometheus 指标现在会验证磁盘配置是否仍与当前运行版本一致；配置漂移、文件不可读或等待重启时返回 HTTP 503，doctor 会给出对应原因，避免编排系统继续把不可安全重启的实例视为就绪。
- 02f1f17: 新增可复用的声明式 HTTP 平台动作契约，统一校验字段、类型、范围、条件必填、对象数组及 POST query/body；KOOK 迁移到该公共契约，Heychat 的 36 个官方动作按领域拆分并关闭任意参数透传。
- e7774a7: 新增可复用的平台动作参数契约注册器，并让微信客服命名动作严格拒绝未知字段及类型错误的可选参数。
- e627175: 配置 Schema 注册改为与扩展工厂一致的唯一性契约：同一对象重复注册保持幂等，不同 Schema 占用同一适配器或协议键时立即拒绝，避免运行时校验和 Web 表单被后加载插件静默替换。
- 889c57f: 修正托管令牌验证器忽略来源开关与附加验证函数的问题，并让 HMAC 验证将畸形或长度错误的签名稳定返回为鉴权失败，而不是抛出运行时异常。
- 740bb95: 修正 ConnectionManager 首次连接失败后不再重连的问题，并隔离停止或重启前的旧连接结果。

  修正 Discord Gateway 的 Resume 握手、远端正常关闭恢复和延迟任务清理，并提供受控的完整 Discord v10 REST API 入口。

- 6a88f9f: 抽取可等待的 EventEmitter 投递与按键单航班基础设施；企业微信 Webhook 现在等待异步监听器、合并并发重试，并补齐日历、日程与审批平台动作。
- 46ca10c: 补齐 Milky 会话置顶、群公告、群精华与永久群文件动作，并统一参数、能力与未知 API 的结构化错误响应。
- 9ed209b: 统一 Telegram polling/webhook 生命周期、原始 Update 接收与结构化错误边界，补齐无限重连、事件去重、Reaction/批量删除/交互与原生 mention 投影，并扩展动态接收配置和完整 Bot API 调用能力。修正无 caption 媒体吞文本、ID 校验及代理运行时依赖归属。
- 0d082ec: 完善 Zulip 草稿查询、批量创建、完整编辑和删除契约，并补齐精确事件、默认订阅与 canonical 资源通知。
- 83490a7: 统一由平台动作注册表派生不可变能力描述，保留各平台权限、上下文与场景差异，避免动作实现、Web 能力展示和支持动作查询发生漂移；微信公众号原生语言参数查询改用不与 canonical 动作冲突的 `get_wechat_user_info`。
- 3d99a6f: 提供显式读取底层依赖 package.json 版本的公共入口，并让钉钉与 ICQQ 删除最后两套重复包元数据解析逻辑，同时继续准确报告 SDK 版本。
- 6bf71c2: 验证适配器创建的账号实例身份、所有权与运行接口，并在验收失败时撤销构造期路由。
- 8432713: 在单账号新增和编辑进入运行态前校验非空身份及完整插件 Schema，并让管理 API 以 HTTP 400 返回无效账号配置。
- 341bb56: 验证第三方账号返回的协议集合与配置及注册表一致，拒绝遗漏、重复或注入协议实例。
- 8fc9573: 统一账号配置键与路由身份校验，在 Web、账号 API、启动、热重载、doctor 和服务预检进入扩展前拒绝空身份及会改变 URL 语义的字符。
- 45cbd06: 在适配器与协议实例进入运行态前验证工厂返回值的注册身份、宿主归属、配置身份和必需方法。
- 103a6fd: 拒绝空数据库路径，并让 doctor 验证解析后的实际 SQLite 文件及父目录，将绝对路径和逃离默认数据目录的相对路径纳入部署门禁。
- 5f983f9: 让运行时与 doctor 共享站点静态目录的真实路径检查，并在诊断报告中公开、修复和验证最终目录。
- 5d13602: 为健康端点发布进程实例身份，并让服务启动与重启在新实例通过在线验证后才报告成功。
- 7e38b87: 在账号运行态、Web 管理端和 doctor 中展示每个协议出口的身份、路径与生命周期，便于定位账号在线但协议启动失败的问题。
- 66107f6: 在所有协议共享的 Web 事件过滤器中直接提供事件子类型字段，便于可视化筛选平台细分事件而无需手写 JSON 路径。
- 4771868: 统一 Router 的 WebSocket 路径与关闭语义，停止时先拒绝新升级并终止活跃连接，避免清理永久等待。
- 6ae74a5: 增加 Zulip Channel Folder 的完整资源动作、精确事件类型与统一资源生命周期投影，并扩展核心资源类型。
- d3b1ce8: 补齐 Zulip 组织默认频道的管理员增删动作、精确快照事件和 canonical 策略通知，并完整声明既有频道事件能力。
- 7da1989: 新增 Zulip 组织新用户默认设置管理员动作、精确事件类型与 canonical 策略通知，并复用个人设置字段模型。
- c884f81: 增加 Zulip Navigation View 的完整资源动作、精确事件与统一资源投影，并抽离可复用的事件投影基元。

## 1.2.5

### Patch Changes

- 9cc0622: 闭合好友申请事件与处理能力链路，并为 Milky V1、OneBot 11 和 OneBot 12 提供保留原始申请凭据的同意好友申请 API。
- c9e876c: 建立统一的 Adapter 能力清单与结构化能力错误，修复 Teams、Mock 和企业微信事件投递，并复用微信生态回调验签、解密与 XML 解析实现。
- 844a041: 将事件过滤 AST、编辑器转换与执行器收口为共享模块；由 imhelper 统一管理 SDK 接收传输生命周期，并从 Milky 协议类抽离纯事件投影模块。
- f1493f6: 删除 Web 包中不可达的旧版 imhelper 副本与无效兼容类型；由协议 Schema 声明表单语义分区，并通过统一布局模块生成协议配置界面。
- 78c1e50: 统一 SDK 地址语义并移除隐式 OneBots 路由兼容逻辑；为协议 Schema 增加事件过滤器元数据，在 Web 配置页提供可增删的可视化规则编辑器与高级 JSON 模式。
- 03cc74d: 为 Milky、OneBot 11 和 OneBot 12 增加统一的 `invite_friend_to_group` 扩展 API，并通过通用 Adapter 能力调用 ICQQ 的原生好友入群邀请。

## 1.2.4

### Patch Changes

- 7891a2e: 丰富协议配置 Schema 的表单元数据，在 Web 管理端为 Webhook 与反向 WebSocket 提供动态增删和单项高级设置，并移除全局表单中的账号重复配置。

## 1.2.3

### Patch Changes

- 41f4bcc: 改进 Web 配置、日志与验证管理，补充 MCP 和协议格式测试，并收紧核心、适配器及协议实现的公开类型。四个客户端 SDK 的事件扩展字段和默认响应数据由 `any` 收紧为 `unknown`，调用方需先进行类型收窄。

## 1.2.2

### Patch Changes

- 4fd55a6: 登录验证与配置 Schema 体验修复：
  - 微信 ClawBot 二维码过期自动换码后推送到 Web 并更新 UI；登录成功清理待处理验证
  - ICQQ 将 `login_error` / `offline` 的 message 推送到验证面板，提供「重新登录」等快捷操作；扫码 / 身份验证 / 设备锁统一「已完成，继续登录」
  - `VerificationRequest` 新增 `actions`、`confirmLabel`，网关支持 `verification:clear`
  - 配置 Schema 彻底用 `choices` 替代 `enum`（含中文选项）；object 字段（如 `log_config`）留空不再默认写成 `{}`
  - 拦截 ICQQ SSO 心跳等未处理 Promise rejection，避免拖垮进程；网络闪断依赖自动重连、不误推重登；微信轮询瞬态网络错误降级为 warn

## 1.2.1

### Patch Changes

- 922a341: Use native relative ESM imports in core runtime sources so plain TypeScript builds remain directly loadable without a later alias-rewrite step.
- 15b2540: 适配新版 ICQQ 登录流程：`Adapter.VerificationRequest` 新增 `confirmable` 字段（无需输入、仅需用户确认的验证）。adapter-icqq 补监听 `system.login.auth` 身份验证事件并推送到 Web；扫码确认与身份验证完成后，用户可在 Web 管理端点击「继续登录」按钮，提交后显式调用 `client.login()` 继续登录流程（此前这两步缺少继续通路，登录会卡住）。
- 15b2540: 修复微信 ClawBot（iLink）登录二维码在 Web 管理端无法显示的问题：iLink 的 `qrcode_img_content` 是二维码页面 URL 而非图片，直接 `<img>` 展示会裂图。`Adapter.VerificationBlock` 新增 `qrcode` 内容块类型，适配器改发该类型（并附链接兜底），Web 管理端用 `qrcode` 库在本地渲染二维码图片。

## 1.2.0

### Minor Changes

- 4564d68: refactor: Phase 3-5 架构优化补完

  Phase 3: 大文件拆分
  - refactor(core): adapter.ts 1562→382 行, ID 管理提取到 adapter-id-manager.ts
  - refactor(onebots): app.ts 1209→~400 行, 7 个路由模块 (auth/adapter-api/config/terminal/verification/public-static)

  Phase 4: 测试覆盖提升
  - test(core): proxy/id-manager/retry 单元测试 (21 用例)
  - test(adapter-mock): 完整生命周期集成测试 (86 用例)
  - test(protocol): CQ 码解析 + 格式转换测试 (40+ 用例)

  Phase 5: 工程规范
  - ci: ESLint flat config, no-explicit-any/no-console 门禁
  - refactor: 18 适配器 barrel export 清理
  - chore: 硬编码超时提取为命名常量
  - docs: CONTRIBUTING.md 中文贡献指南

## 1.1.0

### Minor Changes

- d9fdbd5: refactor: Phase 0+1 架构优化

  Phase 0: 安全与稳定基线
  - fix(service-manager): execSync → execFileSync, getHomeDir() 安全兜底
  - fix(app.ts): 空 catch 块加注释或日志输出
  - chore(vitest): 测试范围扩展到 adapters/ 和 protocols/

  Phase 1: 统一基础设施
  - feat(core): 新增 proxy.ts 统一代理 Agent 工厂（createProxyAgent, buildProxyUrl, maskProxyUrl）
  - feat(core): 改进 ConnectionManager（logger 注入, onConnected/onMaxRetriesReached 回调）
  - refactor: 6 个适配器迁移到共享代理工具, 3 个适配器迁移到 ConnectionManager
  - fix(onebots/index.ts): 消除 export \* from '@onebots/core'，改为显式导出

## 1.0.6

### Patch Changes

- b00497a: fix: 调整发布流程,做首次release

## 1.0.5

### Patch Changes

- ee4e625: ## 新增 `@onebots/adapter-wechat-ilink`

  微信扩展 / **iLink Bot HTTP** 适配器（平台名 `wechat-ilink`），自实现扫码、`getupdates` 长轮询、CDN 媒体收发与 JSON API。

  ### 功能摘要
  - **约定大于配置**：API/CDN 根地址、`bot_type=3`、无会话时自动扫码等由适配器固定，YAML 仅需账号段 + 可选超时（`qr_login_timeout_ms` / `polling_*`）。
  - **会话持久化**：登录态 JSON（`data/wechat-ilink/<account_id>.json`）仅存 token/sync 等；**`context_token` 写入主库 SQLite 表 `wechat_ilink_context_token`**（按 OneBots `account_id` + 对端 peer，写入时带会话 `ilink_bot_id`）；旧 JSON 内 `contextTokens` 首次启动自动迁库。
  - **Web 管理端**：扫码登录时 `emit('verification:request')`，与 icqq 一致推送到控制台「登录验证」SSE；HTTPS 二维码 URL 使用 `image_url` 块**直接内嵌展示**，无需再点链接打开。
  - **账号状态**：长轮询改为后台运行，启动完成后正确 `ready`，Web 端显示在线。
  - **API**：`getFriendList` 返回单条好友信息，字段来自会话 `CredentialBlob.userId`（微信用户），`accountId` 为机器人不在好友条目中误用。

  ### 依赖与配套
  - **`@onebots/core`（patch）**：`Adapter` 的 `id_map` 表名对平台名做安全化；`VerificationBlock` 增加 `image_url`；`SqliteDB` 增加 `execSQL` 供复合主键建表等 DDL。
  - **`@onebots/web`（patch）**：验证面板支持渲染 `image_url` 块（`referrerpolicy="no-referrer"`，兼容微信 CDN）。

  ***

  ## English summary
  - **New package** `@onebots/adapter-wechat-ilink`: WeChat extension via iLink Bot HTTP (`wechat-ilink`), with QR login, long polling, CDN media, and JSON APIs.
  - **Convention-first config**; session file under `data/wechat-ilink/<account_id>.json` by default.
  - **Web verification** push for QR login; **online status** after polling starts; **`getFriendList`** uses session `userId` for the single stub friend row.
  - **`@onebots/core`**: sanitize `id_map_*`; `VerificationBlock` `image_url`; `SqliteDB.execSQL`.
  - **`@onebots/web`**: render `image_url` in verification drawer.

## 1.0.4

### Patch Changes

- 2645ccf: 新增全局配置 `public_static_dir`：托管站点根静态文件（如企业微信可信域名校验 txt）；Docker / HF 入口脚本创建 `/data/static` 便于与配置一并持久化；Web 管理端「配置 → 站点静态」支持列表、上传与删除；`koa-body` 启用 multipart（单文件 ≤2MB）。在 Hugging Face Space 等已配置 `HF_TOKEN`、`HF_REPO_ID` 时，上传/删除站点静态文件后会自动调用 HF commit 接口，重新打包提交 `config_backup.yaml` 与 `data_backup.tar.gz`（含 static）。

## 1.0.3

### Patch Changes

- 5d3787b: fix: v1.0.1

## 1.0.2

### Patch Changes

- 78d4de2: fix: bump version

## 1.0.1

### Patch Changes

- 4f7255b: chore: 切换到 npm OIDC 可信发布
  - 移除 NPM_TOKEN 依赖
  - 使用 GitHub OIDC + Provenance 发布
  - 所有 25 个包已配置 Trusted Publishers

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

## 0.5.0

### Minor Changes

- f3372b5: fix: refactory

### Patch Changes

- f3372b5: fix: 初始化管理
