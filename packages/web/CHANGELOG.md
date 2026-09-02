# @onebots/web

## 1.0.17

### Patch Changes

- Updated dependencies [b806e6f]
  - @onebots/core@1.2.9

## 1.0.16

### Patch Changes

- ba672b9: 新增可动态注册和加载的 Framework Integration Provider，补齐 Kovi、AstrBot、LangBot、AliceBot 与 Kotori 的固定版本连接方案和互操作门禁，并将机器人框架整理为一级解决方案入口。
- d449626: 修复配置默认值未进入运行实例、可选空字段误报、休眠协议阻止启动和 Web 表单保留数字字符串的问题，统一 OneBot 心跳与请求超时的毫秒语义，并避免 Satori 默认值覆盖来源适配器的平台身份。
- Updated dependencies [a02ada0]
- Updated dependencies [e3eb81b]
- Updated dependencies [d449626]
- Updated dependencies [7f70d7a]
  - @onebots/core@1.2.8

## 1.0.15

### Patch Changes

- 42dc575: 新增 18 个已调研机器人生态候选的分级目录，并在 CLI、管理 API、Web 管理端与中英文文档中区分可生成方案的框架和待验证候选。
- 285a0bd: 补齐机器人发行版常用的好友删除、消息历史与合并转发动作，发布云崽和真寻的固定源码兼容矩阵，并在管理 API 与 Web 页面提供七套框架的脱敏接入方案。
- d635329: 加入 melobot 3.4.0 与 ZeroBot 1.8.2 的固定版本真实进程门禁和配置生成方案，并记录其余下一批框架的固定源码阻断证据。
- ce480b1: 新增完整 Twitch Helix 与稳定 EventSub 适配器，支持主动 WebSocket、签名 Webhook、已有 HTTP Host、已有 socket 和 manual ingress，共享严格验证、可靠去重、动态能力及结构化配置表单；同时让通用 record-list 支持行内下拉与条件字段，并发布 Twitch 能力目录。
- Updated dependencies [ce480b1]
  - @onebots/core@1.2.7

## 1.0.14

### Patch Changes

- 022aa80: 管理 API 现在保留 `describeCapabilities(accountId)` 返回的账号级能力覆写，Web 能力面板可按账号查看并区分专属清单与适配器默认清单，同时以稀疏映射避免重复传输未变化的能力数据。
- 6716778: Web 配置保存现在会串行执行原子写盘与运行时热重载：应用失败时恢复上一版本，并发保存返回冲突；宿主网络等不可热重载字段会明确提示需要重启，界面在整个应用过程禁用重复提交。
- d4acf1d: 为账号运行态和生命周期操作绑定 OneBots 实例身份，拒绝跨实例拼接的管理快照与过期操作。
- 7de9672: 将在线适配器能力目录绑定到当前进程实例与受管启动契约，阻止 doctor 接受代理缓存的旧实例证据，并从管理响应中移除不必要的插件绝对入口路径。
- 5ace043: 为配置正文、Schema 与账号配置写操作绑定运行实例和内容修订号，拒绝跨实例快照与过期编辑覆盖。
- 8451a27: 为扩展目录与包变更租约绑定同一 OneBots 实例身份，并在 Web 与 doctor 中拒绝分裂快照。
- 42dc286: 将扩展安装绑定到已验证的实例与配置修订，并验证安装完成回执。
- d7eccb8: 将公开静态文件上传和删除绑定到已验证的实例与目录快照。
- fb1a96d: 为系统信息、在线配置诊断和远端备份绑定 OneBots 实例身份，拒绝跨实例管理证据与过期操作。
- fb45ed6: 将账号登录验证列表、事件流、短信请求与验证提交绑定到同一 OneBots 实例，并在刷新时移除已经消失的旧验证请求。
- 1b843b1: 让 Web 扩展中心公开目录完整性故障，并在服务端与页面同时阻止不可信的安装和版本切换。
- fd26734: 为登录、链接鉴权码验证和令牌刷新增加统一超时边界与可区分的网络失败提示。
- 9cf5b5f: 为主动登出增加 5 秒请求边界，并在服务端不可达时可靠清理浏览器本地会话。
- 5c55740: 为 Web 的健康、就绪与重启验证请求增加独立超时。代理保持连接但不返回响应时，页面现在会给出明确证据并结束有限重试，不再永久停留在检查或重启状态。
- d28e16c: 账号向导要求至少启用一个已加载的开放协议，并在协议缺失时直达扩展安装入口，避免走完整个向导后才发现账号没有消息出口。
- 422c5dc: 为日志 SSE 增加实例身份握手，并在重连时按实例边界采用缓存与实时日志。
- 47dec1e: 将管理端的插件默认选择从通用 JSON 输入升级为开放的列表编辑器：当前运行时已验证的插件会作为带包名和版本的建议，第三方插件仍可通过短名或完整包名自由添加。Schema 新增显式的开放选项列表契约，避免把运行时建议误作封闭白名单。
- fdf0dec: 账号向导区分平台能力加载、失败、未安装与已卸载状态，并提供重试或适配器安装入口，避免首次部署只看到无法操作的空平台列表。
- 814da1c: 扩展安装长请求断线后根据服务端操作 ID 恢复轮询、失败展示或安全重启，避免误报网络失败。
- b89cc37: 让 Web 控制台在发送终端输入或重启命令前验证 HTTP 目标与 WebSocket 实例身份一致。
- 9c9c2f9: 在机器人管理页增加适配器能力概览，按动作、事件、消息段和传输方式展示运行时能力清单，并标明原生、模拟、不支持、权限和上下文限制；使用注册表中的展示名与说明辨识平台，同时为已加载适配器但尚未配置账号的状态提供明确引导。
- a472a9d: 统一限制 Web 管理接口响应正文大小，覆盖配置、运行态、扩展、验证、备份与生命周期操作，并在超限时取消读取和保留明确错误。
- 85784a8: 收紧 npm 发布边界：TypeScript 包不再携带测试产物，Web 管理端只发布构建后的 `dist`。发布流水线会真实打包全部工作区包，拒绝测试、源码、`node_modules` 泄漏或缺失入口的 tarball。
- fda6496: 收紧 CLI 的可选 MCP stdio 模块、鉴权路由和 OneBot v11 自定义音乐段类型边界，集中 CLI 输出与 Web 客户端诊断出口；setup 仅从实际加载的协议生成默认配置，并清理会掩盖真实类型问题的宽泛断言和无效变量。
- 20744e5: 允许配置 Schema 根据已有兄弟字段推断缺失选择值，避免管理端编辑旧配置时覆盖或删除隐藏凭据。
- 410dfb9: 能力清单展示场景的中文标签与原始枚举，并让平台能力搜索同时匹配两种证据。
- c495e37: 扩展接口与管理端现在会在已加载的平台卡片中展示插件注册的默认能力摘要和完整清单，使用户能在创建账号前确认原生、模拟、不支持及权限限制；未声明能力的第三方适配器会明确标记为未知。
- 0e1b962: 运行时校验每个扩展的配置目标并隔离目录漂移；从协议入口编辑已有账号时直接定位并启用目标协议。
- f4c648f: 让配置保存和账号增删改返回可验证的精确配置修订，并要求实例、操作、目标及响应头与正文共同证明提交结果。
- 4f510a1: 让账号上线与下线请求使用完整 OneBots 实例身份，并要求标准响应头和 JSON 回执共同证明目标账号的处理结果。
- e7c4d95: 闭合账号运行态与能力证据契约，并阻止插件附加字段进入管理响应。
- 9806c68: 闭合扩展安装、停用和依赖卸载的成功证据，并为可信失败回执增加稳定错误码。
- dfa50e7: 让备份与重启请求使用完整 OneBots 实例身份，并要求标准响应头和 JSON 回执共同证明处理进程。
- cee3510: 区分已验证、未知和不可用的适配器能力证据，并在目录校验失败时保留平台入口但隔离不可信快照。
- 9763f8f: 让扩展卡片分别展示依赖安装、启动配置和当前进程状态，并提供准确的恢复操作。
- 86ab690: 为配置 Schema 增加声明式条件显示，Web 表单会动态隐藏并清理非当前模式字段；Discord Intents 与 Telegram Update 订阅改为可增减选项，并统一 Telegram polling/webhook 接收计划及运行时校验。
- e4a2c30: 为 readiness 增加明确的运行态操作类型，并让 doctor、Web 与 Prometheus 区分完整配置重载、账号配置事务和手动上下线。
- cef5489: 显式发布适配器的账号生命周期控制能力，并让管理端上线、下线操作在目标缺失或插件未实现时返回可验证的失败结果。
- a76a59b: 新增独立的适配器能力清单 API，使零账号部署无需依赖扩展安装目录即可查看版本绑定的平台能力；Web 能力概览会校验响应身份，并在目录请求失败时保留运行时清单与重试入口。
- 20bb9d2: 显式加载 Vite 客户端环境类型，修复干净构建环境中 `import.meta.env` 缺少类型声明导致的构建失败。
- 4a49b75: 扩展清单独立发布当前进程实际加载版本，Web 在磁盘版本尚未切换时显示证据与重启操作。
- 6a92444: 修复配置管理表单页因错误访问组件属性而无法渲染的问题，并在 Web 构建前执行 Vue 类型检查以阻止同类运行时错误进入产物。
- 99ff290: 让管理端重启先优雅释放运行资源，并由 Web 验证不同的新进程实例上线后再报告完成。
- 3739db4: 在首次无机器人空状态提供能力比较与状态相关的下一步入口，未加载适配器时直达扩展安装，已有适配器时直接打开新增账号向导。
- 7f0d5c8: 让 `/ready` 声明当前 OneBots 应用、版本和进程实例身份，并让 Web、doctor、status 与官方容器探针拒绝无法归属到具体 OneBots 实例的就绪响应。
- 5591c34: 能力目录加载失败时撤销旧目录快照，同时保留可信的机器人账号和已加载适配器运行时清单。
- 34b2d31: 隔离应用与管理认证限流预算，为失败登录提供重试提示，并安全保存自定义限流键。
- cf439fc: 让扩展安装只在存在可验证监督器时自动重启服务。
- 2408c76: 管理 SSE 改用 Authorization Fetch 流并统一取消与重连，普通 HTTP 不再接受 URL 查询令牌。
- 3b3c26d: 修正扩展中心对运行时能力证据的可信状态：插件版本未知时不再误报为已验证，并在保留清单浏览能力的同时明确提示该证据无法绑定到可归档的软件包版本。
- 13bfca1: 扩展目录为适配器与协议声明不同的配置目标；管理端分别进入账号创建和协议出口配置，并在新增账号时自动选中目标协议。
- 24893a8: 修复功能扩展长列表无法滚动的问题，并默认折叠已启用扩展的配置步骤，避免相邻卡片被异常撑高。
- 776a285: 限制认证管理 SSE 的单事件字节大小，超限时取消流并停止自动重连，同时保留长期连接处理多个正常事件的能力。
- d17db13: 主动公开跨进程软件包变更状态，并让扩展管理页与 doctor 在安装或更新期间展示可验证的事务证据。
- 7ce4eac: 收敛 Web 终端的连接代次和重连定时器，避免手动重连产生重复连接，并在页面卸载时停止后台重连。
- 0d3b010: 让 doctor、status、启动更新验证与 Web 系统页只组合来自同一应用版本和进程实例的 `/health`、`/ready` 证据。
- c548700: 在启动配置损坏或不可读时继续发布扩展能力目录，显示脱敏诊断并在下载依赖前阻止安装。
- e3a0523: 为全部普通管理 API 响应和 Web 管理请求统一禁用缓存，避免复用旧运行态、配置或凭据响应。
- 6de06a7: 禁止管理页面发送 Referer，避免首屏查询鉴权码在脚本与样式加载期间随来源地址泄露。
- 24795c5: 允许适配器按账号抬高完整启动事务的保护窗口，并在账号摘要中公开最终生效值。

  微信 ClawBot 现在会保留默认 480 秒扫码窗口，同时响应账号启动取消信号，避免被全局 30 秒默认值提前中断。

- 8980ee8: 闭合 Web 重启请求的实例身份链。管理端现在携带预探测到的实例身份，服务端在预检前拒绝已被其他进程接管的过期请求，并返回应用、实例与调度状态；Web 只有验证完整回执后才等待新实例上线。
- 496f111: 分离在线主程序与 Core 版本身份：健康端点、Prometheus、系统信息和 Web 分别展示实际 `onebots` 与 `@onebots/core` 版本；doctor 会对比在线主程序与当前 CLI，版本漂移在严格模式下阻止部署。
- aad8f52: 将账号动态能力清单错误隔离为机器可读诊断，并在 Web 能力面板明确提示默认清单回退，避免单个第三方适配器错误破坏整个管理页。
- 28a8ace: 将消息调试历史、实时事件流和清空回执绑定到同一运行实例，并通过清除序号边界正确处理迟到事件。
- b4dae78: 为扩展安装操作公开稳定的操作标识、开始时间和可观测阶段，并在 Web 扩展中心区分依赖安装与隔离预检进度。
- f321456: 管理端重启前复用守护服务预检，验证全部插件入口、注册契约与运行配置；失败时保留当前服务并在扩展页面显示具体诊断，避免进入重启崩溃循环。
- 329f109: 扩展停用现在发布稳定的活动操作与最近终态证据；管理页面在长预检请求断线或目录暂时不可读后会继续跟踪同一操作，并根据可信终态恢复重启或展示失败诊断。
- 0e99e8e: 改进扩展安装的断线与并发恢复。同一扩展的重复请求现在复用一个服务端安装操作，不同扩展继续互斥；扩展页会在服务端安装进行中自动刷新到最终成功或失败状态。
- aa14384: 为 Hugging Face 备份增加受信任扩展恢复清单与数据归档降级证据；归档超限时仍安全更新配置，并在新卷启动前按当前目录固定版本恢复扩展依赖。
- beda887: 为账号配置失败增加稳定错误码，并在表单来源失效时自动刷新可信快照。
- 97bdc89: 让系统页自动刷新进程与成对探针证据，合并重叠的手动或定时请求，并停止各页面未使用的重复资源轮询。
- 14ed8a6: 在扩展中心识别版本一致但入口损坏或越界的依赖，并通过强制重新安装固定版本提供可操作修复。
- 2b6e60b: 扩展包安装成功但后续预检或配置提交失败时，恢复安装前的依赖版本并保留回滚失败证据。
- 5de897a: 记录进程最近成功应用的配置文件快照，在管理 API、Web 系统页和 doctor 中检测磁盘配置尚未重载或重启的漂移状态。
- c234f7e: 保留已通过契约校验的插件包名、版本与实际入口，并在管理 API、Web 系统页和 doctor 中展示当前进程真正加载的扩展清单。
- d3c46d8: 让随包发布的 Web 管理端从动态 HTML 读取当前网关 HTTP 前缀，使登录、配置、扩展、探针与协议出口无需重新构建即可访问前缀路由。
- ea193f9: 将账号删除管理请求迁移到 POST JSON 契约，并为旧 GET 入口提供带弃用标记的兼容路径。
- d424976: 为扩展中心增加停用重启后的可恢复依赖卸载，并在包管理器部分写入时恢复原精确版本。
- 18575c4: 扩展中心新增安全停用流程：先隔离预检移除插件后的候选配置，再原子更新启动选择并完成可验证重启；已安装依赖会保留，仍被账号或协议出口引用的扩展不会被停用。
- bf2f2fb: 串行化同一账号的跨传输生命周期操作，并让 Web 保留和展示服务端返回的稳定失败证据。
- 32659bc: 让机器人管理的能力概览合并扩展目录快照，在未安装适配器、未加载插件或未配置账号时仍可比较平台能力，并明确标注目录与运行时证据及插件版本。
- 2858c9f: 扩展清单提前发布运行目录身份错误，Web 在安装前显示原因并禁用无效操作。
- 48bfe11: 让管理 API 与机器人页在尚未配置账号时也展示已加载适配器的默认能力和插件版本，并明确标记未声明能力的第三方插件。
- 100bfb0: Web 顶栏与系统页改用 `/health` 和 `/ready` 的完整语义证据展示生产就绪状态，账号在线但协议出口失败、配置未同步或探针响应矛盾时不再显示绿色可用状态。
- 12c8adf: 扩展中心支持在无账号时按平台元数据和权威能力清单搜索，并只把原生或模拟支持的能力作为候选。
- 557b1b1: 让机器人空状态在开放账号向导前确认适配器和开放协议均已加载，并将缺失项直接引导到对应的扩展分类，避免首次部署在保存阶段才发现没有协议出口。
- 2b2361b: 强化 Mock 适配器的 typed 事件入口、确定性事件生成、结构化错误和消息方向隔离，并为配置 Schema 与 Web 管理端增加通用动态记录列表组件。
- dca581b: 重构企业微信自建应用适配器：严格接入官方加密回调与应用群聊语义，补齐统一客户端、原生动作、消息编译、结构化错误、事件保真、Schema、文档和测试；同时让通用配置 Schema 可声明顶层敏感字段，并在 Web 表单中使用密码输入。
- 7506409: 重构 Zulip 适配器：改用官方 Event Queue 长轮询与原生 HTTP 客户端，补齐可靠重连、结构化错误、可嵌入 Client、原始事件入口、频道话题、真实订阅成员、文件上传、事件投影和平台扩展动作；同时抽取可复用的动态选项列表表单，完善 Schema 与中英文文档。
- 4477055: 管理事件流在最终 HTTP 401/403 后停止自动重试，同时继续恢复网络故障和服务端暂时不可用。
- 85f3c34: 终端连接在管理凭据失效时停止自动重试并提示重新登录，同时保留网络中断和服务重启的恢复行为。
- 1e33306: 限制 Web 公开探针与认证回执的响应正文大小，避免异常代理或服务返回无界数据，并在超限时保留已有会话。
- 99d5201: 增加一键安装脚本和 Web 功能扩展中心。安装脚本自动准备 Node.js 24、Web 管理端、默认协议与用户级常驻服务；管理端可从官方白名单安装适配器或协议、持久化启动选择、自动重启，并按平台 setup 流程引导完成凭据与账号配置。
- ab4fe3c: 保留扩展最近一次安装终态和脱敏诊断，使重连或多页面场景仍能识别失败原因与对应操作。
- 8fc9573: 统一账号配置键与路由身份校验，在 Web、账号 API、启动、热重载、doctor 和服务预检进入扩展前拒绝空身份及会改变 URL 语义的字符。
- 282e8e5: 在调用原生 PTY 前校验终端输入与尺寸，并在 PTY 退出后关闭客户端连接以触发可靠重连。
- b8475c0: 在 Web 合并零账号能力证据前深度校验清单、声明状态、版本绑定、平台唯一性与完整性结论。
- d6b9f53: 在扩展目录和包变更租约进入安装决策前校验身份、版本、能力摘要与状态闭合，并原子采用两份响应。
- b26322f: 将扩展中心的能力快照和安装目标绑定到同一个验证版本。所有目录适配器与协议现在公开验证版本和已安装版本，安装器使用精确版本并校验落盘结果；管理端会提示版本偏离，并允许切换回当前 OneBots 验证的版本。
- 10d462d: 为适配器能力目录发布标准实例身份头，并在 Web 与 doctor 中闭合响应头、正文和运行实例证据。
- b6f422c: 为完整配置保存增加稳定错误码与可验证操作回执，并在 Web 读取正文前闭合响应实例和应用状态。
- da99b42: 在扩展清单、安装入口和 doctor 中提前验证运行目录所需的 npm 或 pnpm 可执行入口，并允许已安装且版本匹配的扩展在缺少包管理器时继续启用。
- 3670e84: 校验扩展目录中的包名身份，并在扩展中心展示损坏或被替换的依赖清单。
- e8f3f9f: 让 doctor 独立验证在线实例发布的全平台能力目录、应用身份、官方平台闭集、固定版本与派生摘要，并将无法绑定包版本的运行时能力明确降级为未知证据。
- cc540c2: 让 Web 在发送登录与刷新凭据前验证公开 OneBots 身份，并拒绝重定向或跨实例认证回执。
- 3b37442: URL 鉴权码改为先由服务端验证再写入本地会话，无效链接不再覆盖已有登录状态。
- 0720e45: 修复 Web 重启验证在旧实例身份探测失败时可能把原进程误判为新进程的问题。系统页与扩展页现在必须先取得可信的 OneBots 实例身份，否则不会发送无法验证结果的重启请求。
- 30f9679: 扩展中心现在会在安装适配器和创建账号前展示绑定包版本的能力目录快照；插件加载后自动切换到运行时注册清单，并通过生成器与测试防止目录和适配器能力静默漂移。
- 7e38b87: 在账号运行态、Web 管理端和 doctor 中展示每个协议出口的身份、路径与生命周期，便于定位账号在线但协议启动失败的问题。
- Updated dependencies [4fb5a8b]
- Updated dependencies [6716778]
- Updated dependencies [d19d9a6]
- Updated dependencies [a43a80e]
- Updated dependencies [b688f78]
- Updated dependencies [18ea42b]
- Updated dependencies [6638635]
- Updated dependencies [8903cca]
- Updated dependencies [caac8eb]
- Updated dependencies [47dec1e]
- Updated dependencies [16baf4b]
- Updated dependencies [fe109c2]
- Updated dependencies [650faf3]
- Updated dependencies [f22eab6]
- Updated dependencies [4fee4cb]
- Updated dependencies [a3a22b4]
- Updated dependencies [4cef9d7]
- Updated dependencies [c9c7a8f]
- Updated dependencies [aaa069d]
- Updated dependencies [347e73f]
- Updated dependencies [c30ac97]
- Updated dependencies [c2f2c32]
- Updated dependencies [e03f801]
- Updated dependencies [005e0b5]
- Updated dependencies [85784a8]
- Updated dependencies [fda6496]
- Updated dependencies [20744e5]
- Updated dependencies [a5c1a35]
- Updated dependencies [3bf18f6]
- Updated dependencies [03e196a]
- Updated dependencies [f4c648f]
- Updated dependencies [4383e38]
- Updated dependencies [c3d1cf4]
- Updated dependencies [e1d5678]
- Updated dependencies [71fdd97]
- Updated dependencies [ef7d86b]
- Updated dependencies [e69ebfc]
- Updated dependencies [9e70080]
- Updated dependencies [a13c7e0]
- Updated dependencies [5d0ee5f]
- Updated dependencies [86ab690]
- Updated dependencies [44de2fd]
- Updated dependencies [543a02c]
- Updated dependencies [0fd3b1b]
- Updated dependencies [e4a2c30]
- Updated dependencies [cef5489]
- Updated dependencies [31a5f8d]
- Updated dependencies [fe08d63]
- Updated dependencies [e03f801]
- Updated dependencies [41199e5]
- Updated dependencies [27b72e3]
- Updated dependencies [5ebc795]
- Updated dependencies [b67d335]
- Updated dependencies [42b8ade]
- Updated dependencies [1a5dbb7]
- Updated dependencies [ab9e08f]
- Updated dependencies [4c27657]
- Updated dependencies [0f4acc0]
- Updated dependencies [783051c]
- Updated dependencies [c2bbba4]
- Updated dependencies [7f0d5c8]
- Updated dependencies [1615e73]
- Updated dependencies [a5e99c0]
- Updated dependencies [a5c4f96]
- Updated dependencies [1a65be7]
- Updated dependencies [34b2d31]
- Updated dependencies [3f5df08]
- Updated dependencies [046e50e]
- Updated dependencies [df5bd43]
- Updated dependencies [0de01b3]
- Updated dependencies [59300db]
- Updated dependencies [27c86a3]
- Updated dependencies [d35ccbc]
- Updated dependencies [072b9c8]
- Updated dependencies [f6661b0]
- Updated dependencies [74bbc4b]
- Updated dependencies [ae6dbf5]
- Updated dependencies [ad2523d]
- Updated dependencies [1551f62]
- Updated dependencies [14b06b0]
- Updated dependencies [3be2e2e]
- Updated dependencies [2f0123f]
- Updated dependencies [a950886]
- Updated dependencies [5be37b3]
- Updated dependencies [2e2d50d]
- Updated dependencies [94c6fc6]
- Updated dependencies [486bb90]
- Updated dependencies [24795c5]
- Updated dependencies [860d03c]
- Updated dependencies [519df30]
- Updated dependencies [ff518fc]
- Updated dependencies [8980ee8]
- Updated dependencies [496f111]
- Updated dependencies [92b2d8a]
- Updated dependencies [6977687]
- Updated dependencies [febbf02]
- Updated dependencies [58cbc7b]
- Updated dependencies [78e2b18]
- Updated dependencies [2b9c998]
- Updated dependencies [7953c9a]
- Updated dependencies [2a0016a]
- Updated dependencies [f149bab]
- Updated dependencies [3b3c3a1]
- Updated dependencies [1faf73d]
- Updated dependencies [38eb759]
- Updated dependencies [3941b1d]
- Updated dependencies [1f60104]
- Updated dependencies [61e5c69]
- Updated dependencies [5de897a]
- Updated dependencies [0ca53d8]
- Updated dependencies [4a55c2a]
- Updated dependencies [0141cea]
- Updated dependencies [9665836]
- Updated dependencies [335375b]
- Updated dependencies [bacfbc7]
- Updated dependencies [2b2361b]
- Updated dependencies [866c32d]
- Updated dependencies [dca581b]
- Updated dependencies [7506409]
- Updated dependencies [a992d8e]
- Updated dependencies [e801d8e]
- Updated dependencies [34cccc4]
- Updated dependencies [02f1f17]
- Updated dependencies [e7774a7]
- Updated dependencies [e627175]
- Updated dependencies [889c57f]
- Updated dependencies [740bb95]
- Updated dependencies [6a88f9f]
- Updated dependencies [46ca10c]
- Updated dependencies [9ed209b]
- Updated dependencies [0d082ec]
- Updated dependencies [83490a7]
- Updated dependencies [3d99a6f]
- Updated dependencies [6bf71c2]
- Updated dependencies [8432713]
- Updated dependencies [341bb56]
- Updated dependencies [8fc9573]
- Updated dependencies [45cbd06]
- Updated dependencies [103a6fd]
- Updated dependencies [5f983f9]
- Updated dependencies [5d13602]
- Updated dependencies [7e38b87]
- Updated dependencies [66107f6]
- Updated dependencies [4771868]
- Updated dependencies [6ae74a5]
- Updated dependencies [d3b1ce8]
- Updated dependencies [7da1989]
- Updated dependencies [c884f81]
  - @onebots/core@1.2.6

## 1.0.13

### Patch Changes

- 844a041: 将事件过滤 AST、编辑器转换与执行器收口为共享模块；由 imhelper 统一管理 SDK 接收传输生命周期，并从 Milky 协议类抽离纯事件投影模块。
- f1493f6: 删除 Web 包中不可达的旧版 imhelper 副本与无效兼容类型；由协议 Schema 声明表单语义分区，并通过统一布局模块生成协议配置界面。
- 78c1e50: 统一 SDK 地址语义并移除隐式 OneBots 路由兼容逻辑；为协议 Schema 增加事件过滤器元数据，在 Web 配置页提供可增删的可视化规则编辑器与高级 JSON 模式。
- Updated dependencies [9cc0622]
- Updated dependencies [c9e876c]
- Updated dependencies [844a041]
- Updated dependencies [f1493f6]
- Updated dependencies [78c1e50]
- Updated dependencies [03cc74d]
  - @onebots/core@1.2.5

## 1.0.12

### Patch Changes

- 25ac8a4: 修复加载协议端点配置时对 Vue 响应式对象使用 `structuredClone` 导致配置页无法打开的问题。

## 1.0.11

### Patch Changes

- 7891a2e: 丰富协议配置 Schema 的表单元数据，在 Web 管理端为 Webhook 与反向 WebSocket 提供动态增删和单项高级设置，并移除全局表单中的账号重复配置。

## 1.0.10

### Patch Changes

- 41f4bcc: 改进 Web 配置、日志与验证管理，补充 MCP 和协议格式测试，并收紧核心、适配器及协议实现的公开类型。四个客户端 SDK 的事件扩展字段和默认响应数据由 `any` 收紧为 `unknown`，调用方需先进行类型收窄。

## 1.0.9

### Patch Changes

- 4fd55a6: 登录验证与配置 Schema 体验修复：
  - 微信 ClawBot 二维码过期自动换码后推送到 Web 并更新 UI；登录成功清理待处理验证
  - ICQQ 将 `login_error` / `offline` 的 message 推送到验证面板，提供「重新登录」等快捷操作；扫码 / 身份验证 / 设备锁统一「已完成，继续登录」
  - `VerificationRequest` 新增 `actions`、`confirmLabel`，网关支持 `verification:clear`
  - 配置 Schema 彻底用 `choices` 替代 `enum`（含中文选项）；object 字段（如 `log_config`）留空不再默认写成 `{}`
  - 拦截 ICQQ SSO 心跳等未处理 Promise rejection，避免拖垮进程；网络闪断依赖自动重连、不误推重登；微信轮询瞬态网络错误降级为 warn

## 1.0.8

### Patch Changes

- 15b2540: 适配新版 ICQQ 登录流程：`Adapter.VerificationRequest` 新增 `confirmable` 字段（无需输入、仅需用户确认的验证）。adapter-icqq 补监听 `system.login.auth` 身份验证事件并推送到 Web；扫码确认与身份验证完成后，用户可在 Web 管理端点击「继续登录」按钮，提交后显式调用 `client.login()` 继续登录流程（此前这两步缺少继续通路，登录会卡住）。
- 15b2540: 重构 Web 管理端：弃用 Element Plus，改为 Tailwind CSS v4 + 自研轻量组件库（`src/ui/`），图标迁移到 @tabler/icons-vue，字体自托管 Geist。恢复正常语义色（在线/连接中/离线状态可读），重做侧边栏布局、登录页、机器人卡片、配置页（表单/原始配置/站点静态/账号四页签）、系统信息、日志与终端页，统一明暗双主题设计令牌，删除未使用的 Accounts.vue。
- 15b2540: 修复微信 ClawBot（iLink）登录二维码在 Web 管理端无法显示的问题：iLink 的 `qrcode_img_content` 是二维码页面 URL 而非图片，直接 `<img>` 展示会裂图。`Adapter.VerificationBlock` 新增 `qrcode` 内容块类型，适配器改发该类型（并附链接兜底），Web 管理端用 `qrcode` 库在本地渲染二维码图片。

## 1.0.7

### Patch Changes

- b00497a: fix: 调整发布流程,做首次release

## 1.0.6

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

## 1.0.5

### Patch Changes

- 4465ece: Web 管理端 `/api/config/schema` 合并适配器配置预设：在未使用 `-r` 加载 `wecom-kf`、`icqq` 等包时仍可提供表单项；并补充 line、email、whatsapp、zulip、mock 的预设。账号管理页平台字段改为可搜索下拉并支持手动输入。

  Docker / HF 镜像与 `development` 的 `pnpm dev` 默认增加 `-r wecom-kf`、`-r icqq`（镜像需在构建阶段用 `NODE_AUTH_TOKEN` 装好 `@icqqjs/icqq`，启动后无需 token）。`development` 增加对 `@onebots/adapter-icqq` 的 workspace 依赖以便解析。

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

## 0.5.1

### Patch Changes

- 74fb4fd: fix: change to dev dep

## 0.5.0

### Minor Changes

- f3372b5: fix: refactory

### Patch Changes

- f3372b5: fix: 初始化管理
