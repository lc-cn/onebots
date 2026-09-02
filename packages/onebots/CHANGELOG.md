# onebots

## 1.2.12

### Patch Changes

- Updated dependencies [b806e6f]
  - @onebots/core@1.2.9
  - @onebots/web@1.0.17

## 1.2.11

### Patch Changes

- 80600ef: 新增完整 IRCv3 适配器：支持 Modern IRC TCP/TLS、CAP 302、SASL、已有 socket 与 manual ingress、canonical 事件/API、平台动作、动态能力、结构化 Web Schema 和双语文档。
- a02ada0: 新增与 Adapter、Protocol 同级的内置 Application 运行时扩展，通过 `-t/--target` 选择目标框架，并按框架拆分中英文解决方案文档。
- ba672b9: 新增可动态注册和加载的 Framework Integration Provider，补齐 Kovi、AstrBot、LangBot、AliceBot 与 Kotori 的固定版本连接方案和互操作门禁，并将机器人框架整理为一级解决方案入口。
- e3eb81b: 将 11 个机器人框架目标从 planned 提升为可激活的 experimental 或 legacy Application，补充连接模板、唯一兼容动作、运行时状态、CLI/管理 API 契约测试及中英文解决方案文档。
- d449626: 修复配置默认值未进入运行实例、可选空字段误报、休眠协议阻止启动和 Web 表单保留数字字符串的问题，统一 OneBot 心跳与请求超时的毫秒语义，并避免 Satori 默认值覆盖来源适配器的平台身份。
- 7f70d7a: 收敛机器人框架 Application 的职责：移除专用传输和状态动作，区分真实扩展动作、框架依赖动作与已知缺口，并让所有传输继续由账号协议配置显式控制。

  将 25 个框架解决方案重写为可执行的 OneBots 配置、框架端连接、验证和故障修复手册；同时修复框架配置生成命令的本地构建入口、默认参数以及 Satori 鉴权字段。

- Updated dependencies [a02ada0]
- Updated dependencies [ba672b9]
- Updated dependencies [e3eb81b]
- Updated dependencies [d449626]
- Updated dependencies [7f70d7a]
  - @onebots/core@1.2.8
  - @onebots/web@1.0.16

## 1.2.10

### Patch Changes

- d358230: 加入固定版本 Koishi Satori 互操作门禁，修正官方适配器根端点模板，并在保留既有响应包装的同时支持官方客户端的直接 API 结果。
- 8a0f0a8: 修复 OneBot 11 反向 WebSocket 的 Bearer 鉴权兼容性，并加入固定版本 NoneBot2 真实进程互操作门禁、验证证据与中英文接入说明。
- 42dc575: 新增 18 个已调研机器人生态候选的分级目录，并在 CLI、管理 API、Web 管理端与中英文文档中区分可生成方案的框架和待验证候选。
- 2df841a: 加入固定版本 Karin Milky WebSocket 互操作门禁、验证证据、安全限制和中英文接入说明，并让 `get_impl_info` 对未暴露 QQ 客户端指纹的适配器返回稳定兜底信息。
- 285a0bd: 补齐机器人发行版常用的好友删除、消息历史与合并转发动作，发布云崽和真寻的固定源码兼容矩阵，并在管理 API 与 Web 页面提供七套框架的脱敏接入方案。
- 85b15f7: 加入固定版本 Zhin OneBot 11 正向 WebSocket 互操作门禁、可移植依赖锁、验证证据和中英文接入说明。
- 1f396bd: 加入固定版本 AlemonJS OneBot 11 正向 WebSocket 互操作门禁、验证证据、安全限制和中英文接入说明。
- d635329: 加入 melobot 3.4.0 与 ZeroBot 1.8.2 的固定版本真实进程门禁和配置生成方案，并记录其余下一批框架的固定源码阻断证据。
- ce480b1: 新增完整 Twitch Helix 与稳定 EventSub 适配器，支持主动 WebSocket、签名 Webhook、已有 HTTP Host、已有 socket 和 manual ingress，共享严格验证、可靠去重、动态能力及结构化配置表单；同时让通用 record-list 支持行内下拉与条件字段，并发布 Twitch 能力目录。
- Updated dependencies [42dc575]
- Updated dependencies [285a0bd]
- Updated dependencies [d635329]
- Updated dependencies [ce480b1]
  - @onebots/web@1.0.15
  - @onebots/core@1.2.7

## 1.2.9

### Patch Changes

- 022aa80: 管理 API 现在保留 `describeCapabilities(accountId)` 返回的账号级能力覆写，Web 能力面板可按账号查看并区分专属清单与适配器默认清单，同时以稀疏映射避免重复传输未变化的能力数据。
- a058257: 新增完整 Facebook Messenger 适配器与共享 Meta 基础层：支持可嵌入 Client、已有 HTTP Host 和 manual 事件接入，覆盖 Messenger Platform canonical 事件/API、附件、会话、Profile、订阅、审核、Handover 与 Utility Messaging；同时提供严格签名和外部数据校验、动态账号能力、结构化 Web Schema、测试及双语文档。
- 2ab0416: 新增完整 Google Chat 适配器：支持可嵌入 Client、Interaction HTTPS、Workspace Events + Pub/Sub push 与 manual 接入，共享可靠事件管线；提供 canonical 消息/Space/成员/reaction/read state 投影、稳定 REST v1 平台动作、动态能力、严格鉴权与外部数据校验、Web Schema、测试和双语文档。
- 2cdd9a2: 新增基于 Instagram Login 的完整 Instagram Messaging 适配器，提供可嵌入 Client、Webhook/manual 接入、canonical 投影、动态能力、平台扩展、Schema 与双语文档，并将其加入扩展目录。
- f8702ab: 为 `onebots status` 增加稳定的 JSON 报告，便于部署门禁归档进程、探针与实例身份凭据。
- 9cf29b8: 新增完整 Matrix 适配器：支持可嵌入 Client、`/sync`、Application Service 与 manual 接入，共享可靠事件管线；提供 canonical 消息/房间/成员/反应/回执投影、原生平台动作、动态能力、结构化错误、Web Schema、测试和双语文档。
- 6716778: Web 配置保存现在会串行执行原子写盘与运行时热重载：应用失败时恢复上一版本，并发保存返回冲突；宿主网络等不可热重载字段会明确提示需要重启，界面在整个应用过程禁用重复提交。
- 1232a44: 插件加载器从插件工作目录解析 `exports.import`、`module` 或 `main` 入口，再使用原生动态 `import()` 并等待初始化完成；支持 import-only、条件导出及包含顶层 `await` 的纯 ESM 插件，同时保留初始化失败的具体诊断。
- 1aca612: 让 `onebots config set` 复用安全的原子配置写入，保留配置与备份权限并避免中断时留下截断文件。
- d19d9a6: 配置创建与更新现在统一使用同目录原子替换：写入内容会先同步到临时文件，已有配置的上一版本保存在 `.bak`，并保留已有文件权限与符号链接部署。setup、管理端保存、自动凭据及运行时账号变更不再直接截断正式配置文件。
- a74c75d: 将管理终端的日志 SSE 客户端、心跳和缓存写流纳入可等待停机边界，在写流关闭后再截断临时缓存，并在完成其余资源清理后传播关闭失败。
- d4acf1d: 为账号运行态和生命周期操作绑定 OneBots 实例身份，拒绝跨实例拼接的管理快照与过期操作。
- 7de9672: 将在线适配器能力目录绑定到当前进程实例与受管启动契约，阻止 doctor 接受代理缓存的旧实例证据，并从管理响应中移除不必要的插件绝对入口路径。
- 5ace043: 为配置正文、Schema 与账号配置写操作绑定运行实例和内容修订号，拒绝跨实例快照与过期编辑覆盖。
- 8451a27: 为扩展目录与包变更租约绑定同一 OneBots 实例身份，并在 Web 与 doctor 中拒绝分裂快照。
- 42dc286: 将扩展安装绑定到已验证的实例与配置修订，并验证安装完成回执。
- d7eccb8: 将公开静态文件上传和删除绑定到已验证的实例与目录快照。
- fb1a96d: 为系统信息、在线配置诊断和远端备份绑定 OneBots 实例身份，拒绝跨实例管理证据与过期操作。
- cef9fe8: 将更新目标目录绑定到同一 OneBots 包清单的名称与版本证据。
- 88f8e11: `onebots update` 现在让 registry 查询、目标目录暂存、正式依赖写入和失败回滚始终复用已通过版本校验的包管理器绝对入口。
- 42cb227: 更新版本查询现在固定使用目标运行目录，使项目级 registry 与代理配置不再取决于调用 CLI 时所在的目录。
- fb45ed6: 将账号登录验证列表、事件流、短信请求与验证提交绑定到同一 OneBots 实例，并在刷新时移除已经消失的旧验证请求。
- 72eddec: 扩展安装与失败恢复现在始终执行已通过版本校验的包管理器绝对入口，避免 PATH 或项目证据变化导致实际命令与预检对象不一致。
- 1b843b1: 让 Web 扩展中心公开目录完整性故障，并在服务端与页面同时阻止不可信的安装和版本切换。
- b688f78: 让全局 `timeout` 真正约束账号登录监听器与协议出口启动，超时后中止协作式启动信号、保留失败状态，并继续尝试其他账号。
- 2755a9f: 限制容器 readiness 探针的响应大小，并拒绝重定向和非 JSON 媒体类型，避免错误服务被接受为健康实例。
- c669cae: 限制 doctor 管理 API 响应为 4 MiB，并在超限时取消读取，防止登录、运行态、能力或扩展证据消耗无界内存。
- f13bb5d: 限制 CLI 健康探针响应为 64 KiB，并在超限时取消流式读取，避免错误端口上的未知服务消耗无界内存。
- de86a5e: 为 Hugging Face 数据归档与仓库提交增加固定超时，并限制上游错误正文，避免自动备份让配置和静态文件管理请求无限等待。
- b2b3003: 为 Hugging Face 启动恢复增加固定下载超时、按制品字节上限和私有原子写入，失败时保留既有配置并清理不完整临时文件。
- 4691c3e: 限制管理 WebSocket 与终端的出站消息和慢客户端缓冲，并合并连续日志事件的重复读取。
- 18ea42b: 为插件异步注册事务增加超时、回滚和迟到修改隔离，避免异常入口永久阻塞启动与诊断。
- a430b23: 限制插件清单读取大小，并在加载或扩展状态检查前拒绝非常规清单与入口文件。
- c4b7fc0: 让 SIGINT 与 SIGTERM 的优雅停机在清理失败时继续保留 30 秒强制退出兜底，避免残留网络或 SDK 句柄让进程永久挂起。
- b284ccc: 更新器现在会以超时和输出上限执行 registry 版本查询，提前拒绝受污染的版本证据，并保留经过脱敏的可操作失败原因。
- 6638635: 为 WebSocket 路由提供显式入站消息上限，并将管理端主连接和交互终端分别限制为 4 MiB 与 1 MiB。
- 69ae3cf: 扩展在线 doctor 诊断，验证管理 HTTP 与根 WebSocket 均拒绝匿名访问并接受合法凭据，同时自动清理诊断会话。
- 8903cca: 增加统一 Guild、Channel、Role 与 Emoji 资源生命周期通知模型；完整投影 KOOK 官方资源及成员在线事件，并让 OneBot、Satori 与 MCP 保留对应资源、子类型和平台扩展。
- 422c5dc: 为日志 SSE 增加实例身份握手，并在重连时按实例边界采用缓存与实时日志。
- 47dec1e: 将管理端的插件默认选择从通用 JSON 输入升级为开放的列表编辑器：当前运行时已验证的插件会作为带包名和版本的建议，第三方插件仍可通过短名或完整包名自由添加。Schema 新增显式的开放选项列表契约，避免把运行时建议误作封闭白名单。
- a1ec2aa: 让服务状态在 HTTP 探测前验证平台服务定义与元数据一致，并在 JSON 报告中保存可归档的定义证据。
- 0cd043e: 按结构差异发布账号能力覆写，并在进入管理 API 前校验和冻结动态能力清单，避免内容相同的新对象被误标为账号专属能力。
- 650faf3: 持久化 setup 验证过的适配器与协议选择，并让前台启动、doctor、服务安装、更新和 MCP 模式在未显式传参时复用配置默认值。插件选择发生变化时现在会明确要求重启，避免运行态与磁盘配置不一致。
- 8bb7ae7: 新增 `onebots capabilities` 无连接能力导出命令。它复用配置中的适配器选择，以文本或稳定 JSON 输出实际解析包的默认能力清单、支持级别统计与加载错误，并用退出码区分插件加载失败和能力契约缺失。
- 4253c75: 在扩展安装与更新前把 `catalog:` 依赖识别为 pnpm 证据，并提前拒绝它与 npm 锁文件的冲突，避免 npm 执行后才以 `EUNSUPPORTEDPROTOCOL` 失败。
- 4ca504e: 确保 doctor 的 WebSocket 握手在连接提前关闭或超时时及时失败，不留下悬挂诊断。
- f22eab6: 抽取与对象键顺序无关的 canonical JSON 指纹原语，统一多个适配器的事件回退身份；修复飞书事件缺少 `event_id` 时依赖接收时钟、导致重试事件获得不同 ID 的问题。
- 9b08ce5: 扩展安装会在下载依赖前验证运行配置，并在安装期间配置发生变化时合并最新内容，避免配置错误留下半完成依赖或覆盖并行管理操作。
- cf51fc6: 新增七种机器人框架的版本化接入 profile、可复用连接方案生成接口和 `onebots frameworks` CLI，输出双方配置、端点、验证步骤与明确限制，并保持真实 token 不进入生成结果。
- 002f1be: 一键安装脚本支持安全重复执行：已有配置不再被 setup 参数改写，更新服务定义后切换运行实例；PowerShell 对 npm 和 OneBots 原生命令显式检查退出码，失败时立即停止。
- 5a94953: 插件通过注册契约后锁定实际包名、版本与入口，在执行代码前拒绝同一逻辑名称的身份漂移。
- 7395a14: 在 CLI 与管理端切换受管服务前验证平台定义，防止健康实例退出后由漂移的监督器命令接管。
- a3a22b4: 新增成功后提交的有界事件去重原语，并统一 Slack、Telegram 与 Teams 的重投语义。完善 Teams 标准 Request 入站、真实机器人身份、原始 Activity 保留，以及 Activity 成员和 Azure Bot OAuth 平台动作。
- b89cc37: 让 Web 控制台在发送终端输入或重启命令前验证 HTTP 目标与 WebSocket 实例身份一致。
- 9c9c2f9: 在机器人管理页增加适配器能力概览，按动作、事件、消息段和传输方式展示运行时能力清单，并标明原生、模拟、不支持、权限和上下文限制；使用注册表中的展示名与说明辨识平台，同时为已加载适配器但尚未配置账号的状态提供明确引导。
- 90becd6: 在扩展清单、安装入口和 doctor 中提前验证运行目录及已有依赖目录可写，避免只读挂载或错误属主直到包管理器启动后才暴露失败。
- 85784a8: 收紧 npm 发布边界：TypeScript 包不再携带测试产物，Web 管理端只发布构建后的 `dist`。发布流水线会真实打包全部工作区包，拒绝测试、源码、`node_modules` 泄漏或缺失入口的 tarball。
- fda6496: 收紧 CLI 的可选 MCP stdio 模块、鉴权路由和 OneBot v11 自定义音乐段类型边界，集中 CLI 输出与 Web 客户端诊断出口；setup 仅从实际加载的协议生成默认配置，并清理会掩盖真实类型问题的宽泛断言和无效变量。
- c855fc0: 卸载平台服务定义或私有元数据失败时恢复并复验原定义，避免遗留失去管理契约的系统任务。
- a5c1a35: 抽取微信生态共享 JS-SDK 签名内核，补齐企业微信网页授权、访问者身份、企业/应用 ticket 缓存与签名动作，并收紧可选动作参数类型。
- 3bf18f6: 统一反向 WebSocket 的无限重连与停止生命周期，避免协议停止后遗留连接或定时器重新拉起。

  修正 OneBot 11 仅配置反向 WebSocket 时不发送心跳的问题，并防止 OneBot 11、Milky 重连后丢失事件派发监听。

- ed69269: 让 doctor 分别验证适配器入口与协议出口，避免只选择一类插件的半完成部署被误报为通过。
- a791a41: 修正 doctor 显式诊断候选配置时仍受旧服务定义插件列表影响的问题，并在诊断报告中逐类别公开插件选择来源与模块解析目录。不同配置的独立诊断不会判旧或修复无关的已安装服务定义。
- c495e37: 扩展接口与管理端现在会在已加载的平台卡片中展示插件注册的默认能力摘要和完整清单，使用户能在创建账号前确认原生、模拟、不支持及权限限制；未声明能力的第三方适配器会明确标记为未知。
- 0e1b962: 运行时校验每个扩展的配置目标并隔离目录漂移；从协议入口编辑已有账号时直接定位并启用目标协议。
- 6822b9d: 让 `onebots status --json` 分别输出 API/探针根地址与 Web 管理地址，并让一键安装脚本打印可直接打开的管理页 origin，避免自定义 Router `path` 后落到不存在的页面。
- 75cf697: 让 doctor 保留插件加载失败的具体原因，并复用单次结构化加载结果，便于直接定位重复注册、缺少运行时依赖和初始化异常。
- 03e196a: 增加 canonical 用户组资源生命周期、成员与子组通知，默认订阅 Zulip 用户组事件并逐对象稳定投影，同时移除本地接收时间伪造。
- f4c648f: 让配置保存和账号增删改返回可验证的精确配置修订，并要求实例、操作、目标及响应头与正文共同证明提交结果。
- 4f510a1: 让账号上线与下线请求使用完整 OneBots 实例身份，并要求标准响应头和 JSON 回执共同证明目标账号的处理结果。
- 4383e38: 在账号停止、删除、热重载或候选回滚时撤销其 HTTP 与 WebSocket 路由，避免旧处理器继续占用新账号的同名路径。
- e7c4d95: 闭合账号运行态与能力证据契约，并阻止插件附加字段进入管理响应。
- 967f14c: 让 capabilities 与 doctor 闭合校验扩展白名单、固定包版本和能力快照，拒绝静默漏项与版本错配。
- 9806c68: 闭合扩展安装、停用和依赖卸载的成功证据，并为可信失败回执增加稳定错误码。
- c3d1cf4: 阻止插件在加载事务结束后继续异步修改扩展注册表。
- e1d5678: 闭合平台动作类型：不可变动作集合保留精确联合类型并支持动态字符串收窄，所有适配器从包入口统一导出动作集合、执行器与动作类型。
- ffc586a: 移除主程序内重复且易漂移的适配器与协议 Schema 预设，使已加载插件注册的 Schema 成为运行时校验和 Web 表单的唯一来源。
- dfa50e7: 让备份与重启请求使用完整 OneBots 实例身份，并要求标准响应头和 JSON 回执共同证明处理进程。
- 71fdd97: 完成全平台适配器能力清单，统一声明原生、模拟、权限、场景、事件、消息段与传输能力，并在运行时校验已声明动作确有具体实现，避免管理端和协议层暴露虚假能力。
- ef7d86b: 让平台动作参数契约支持领域子表组合，并统一微信公众号与微信 ClawBot 的命名动作校验实现。
- 0c7740c: 规范化插件包与入口的真实路径，并在执行前拒绝通过包内软链接逃出实际包根的入口。
- c0b47c5: 在 doctor 管理诊断完成后重新核对公开实例身份，拒绝进程切换或端口接管期间拼接出的跨实例证据。
- 9e70080: 新增完整清理流程的失败收集器，并让账号停止复用统一的单错误与聚合错误传播语义。
- a13c7e0: 新增跨代有序事件投递队列，为无法提供异步背压的事件源统一提供顺序、持续退避重试、停止取消与积压观测语义。
- 5d0ee5f: 新增不可变平台动作注册表，并让首批适配器从单一 handler 表派生能力发现与执行。
- bc2609b: 让 `ONEBOTS_ACCESS_TOKEN` 成为一致的部署级管理鉴权覆盖项，避免无法读取配置文件的托管环境在首次启动后无法登录。
- aaec929: 扩展安装与更新现在会把 `npm-shrinkwrap.json` 识别为 npm 的权威证据，避免从 pnpm 环境启动时选错包管理器。
- 8855d48: 扩展安装从 workspace 成员目录启动时向上识别 pnpm，避免误用 npm 解析 `workspace:` 或 `catalog:` 依赖。
- 9b00c8b: 在热重载返回成功或要求重启后重验磁盘配置，避免把并发写入造成的漂移误报为保存成功。
- cee3510: 区分已验证、未知和不可用的适配器能力证据，并在目录校验失败时保留平台入口但隔离不可信快照。
- f66ba47: 区分服务停止与进程管理器查询失败，避免状态、停止验证和更新流程接受不确定证据。
- 87e5353: `onebots doctor` 现在会在 POSIX 系统上分别审计配置文件与 `.bak` 权限：组只读模式明确警告，其他用户可访问或同组可修改会导致检查失败，显式 `--fix` 可将高风险权限收紧为 `0600` 并记录修复结果。
- 610e1b6: 让 `onebots doctor` 验证扩展运行目录与当前 OneBots 进程的包身份和版本一致，并在文本与 JSON 报告中发布 `extension-root` 部署证据。
- e5b6f6f: 在加载 CLI 与平台依赖前检查 Node.js 24 运行时要求，并统一 doctor、安装文档和发布包的版本契约。
- 543a02c: 统一协议与应用 fallback 配置的表单契约，补齐 OneBot、Milky、Satori、MCP 的分区和敏感凭据元数据，并在协议注册时拒绝残缺 Schema。
- 0fd3b1b: 扩展 ICQQ 原生消息、好友、群管理、QQ 频道、文件与凭据能力，并通过 Milky、OneBot 11 和 OneBot 12 接通可准确表达的协议动作；修复群申请 opaque 标识往返与严格布尔参数校验。
- d3976ed: 周期重验管理 WebSocket 与 SSE 会话，令牌自然过期后在 30 秒内停止敏感数据推送。
- e4a2c30: 为 readiness 增加明确的运行态操作类型，并让 doctor、Web 与 Prometheus 区分完整配置重载、账号配置事务和手动上下线。
- b65736f: 让 capabilities 在未安装适配器、未创建账号时导出完整版本化能力目录，并区分快照与运行时证据。
- cef5489: 显式发布适配器的账号生命周期控制能力，并让管理端上线、下线操作在目标缺失或插件未实现时返回可验证的失败结果。
- a76a59b: 新增独立的适配器能力清单 API，使零账号部署无需依赖扩展安装目录即可查看版本绑定的平台能力；Web 能力概览会校验响应身份，并在目录请求失败时保留运行时清单与重试入口。
- fe08d63: 让 `deepClone` 在无法生成独立副本时失败关闭，并在应用初始化、热重载、协议配置继承与账号编辑前克隆合并来源，避免运行配置与调用方对象共享引用。
- 1d83438: 修复 Web 打开命令与 CLI send 对宿主路径的错误拼接，并让 send 复用环境 token、文件 token 或可撤销的用户名登录会话。
- 3111519: 修复多架构 Docker 镜像构建缺失根 TypeScript 配置导致适配器编译失败的问题。
- 25bda51: 让扩展安装、doctor 与能力报告只消费插件加载前生成的深冻结宿主目录快照，并冻结固定包版本和能力目录条目，阻止插件通过共享引用篡改安装白名单与验证身份。
- 04ec996: 更新器默认以当前配置的插件选择生成包清单，确保通过 Web 扩展中心后装的适配器与协议也参与版本检查和更新；显式 CLI 参数按类别优先，旧配置继续回退服务快照。
- 4c51578: 让服务安装和 doctor 与显式扩展运行目录保持一致，避免重启后从错误目录解析插件。
- 4a49b75: 扩展清单独立发布当前进程实际加载版本，Web 在磁盘版本尚未切换时显示证据与重启操作。
- 27e42ca: 按扩展运行目录的真实路径查找包管理器证据，避免符号链接部署的 pnpm workspace 成员回退到 npm。
- 0f37c6d: 让 doctor 仅在公开探针证明当前 OneBots 实例及受管启动契约后发送管理凭据，避免凭据误发给端口上的其他服务。
- abd0009: 让更新检查、暂存下载、正式依赖写入与失败恢复只使用通过实际版本验证的 npm 或 pnpm，避免旧包管理器绕过扩展安装和 doctor 的生产门禁。
- 99ff290: 让管理端重启先优雅释放运行资源，并由 Web 验证不同的新进程实例上线后再报告完成。
- 42b8ade: 禁止第三方账号工厂在候选实例通过宿主验证前修改 Adapter 账号集合，并在越界时恢复原运行态。
- 1a5dbb7: 以可复用且具所有权保护的运行态租约统一配置重载、账号配置与手动上下线，确保同步前置失败也会恢复 readiness。
- 2389591: 在守护服务安装预检和定义提交阶段持续复验配置身份，漂移时恢复原定义或清理首次安装。
- 8a80658: 首次 setup 未选择插件时，也输出能力比较、配置验证、前台启动和服务安装命令。
- 6015fd7: 让 MCP stdio 串行处理请求、将异步失败转换为 JSON-RPC 内部错误，并在输入关闭时等待队列后只清理一次。
- 0f4acc0: 约束相对静态目录的实际路径，并以不跟随符号链接的原子写入管理上传文件，避免静态文件操作越出配置目录。
- 0070471: 为官方 Docker 镜像和 Compose 部署增加基于 `/ready` 的容器健康检查；探针会读取持久化配置中的端口与路径，支持 `PORT`、`ONEBOTS_PATH`、`ONEBOTS_CONFIG_PATH` 和完整 URL 环境变量覆盖，并验证响应明确包含 `ready: true`。
- ab0e3a8: 让重复执行的一键安装脚本保留但不提取或输出已有管理鉴权码，避免升级日志再次暴露长期凭据。
- c59736d: 交互式 setup 按 Schema 敏感标记保留凭据，不再把现有密码或鉴权码带入终端提示。
- 5247361: 独立 doctor 与 send 命令使用运行时 PORT 覆盖配置端口，避免托管环境探测错误地址。
- 7f0d5c8: 让 `/ready` 声明当前 OneBots 应用、版本和进程实例身份，并让 Web、doctor、status 与官方容器探针拒绝无法归属到具体 OneBots 实例的就绪响应。
- a5c4f96: 让协议、账号、适配器与生命周期钩子的停止失败彼此隔离，并在数据库、网络、安全审计和 close 监听器均获得清理机会后统一汇总错误。
- 1a65be7: 隔离 Adapter 与 Protocol 实例工厂对全局扩展注册表的副作用，并在越界时恢复原注册状态。
- d43a159: 为 JSON 证据命令隔离 stdout，避免插件初始化日志和终端提示污染机器可读文档。
- 34b2d31: 隔离应用与管理认证限流预算，为失败登录提供重试提示，并安全保存自定义限流键。
- 3f5df08: 隔离应用会话管理器，并保留访问令牌过期后的有效刷新窗口。
- bec5426: 限制插件加载事务只能修改 CLI 名称承诺的注册项，并在越界注册或冒领已有身份时完整回滚。
- 046e50e: 应用实例现在会固化自己的配置、数据与日志路径，避免后创建的实例改写静态兼容默认值后导致已有实例跨目录读写。
- cf439fc: 让扩展安装只在存在可验证监督器时自动重启服务。
- d5a3f6b: 修复旧管理 WebSocket 首次输入后结束全局 stdin 的问题，支持连续输入并为无效载荷返回明确回执。
- 2408c76: 管理 SSE 改用 Authorization Fetch 流并统一取消与重连，普通 HTTP 不再接受 URL 查询令牌。
- 0de01b3: 禁止缓存健康、就绪与指标响应，并让 CLI 和终端仪表盘始终从规范网关路径读取当前实例探针。
- 59300db: 为 WebSocket 路由提供升级前连接上限，并限制管理主连接和交互终端的聚合连接数。
- b4d1787: 让手动账号生命周期操作与配置事务共享运行态租约，在切换完成前撤销 readiness 并双向拒绝账号替换、删除或配置重载竞态。
- f5e1e8f: 更新检查与无需变更的预检现在会在共享依赖租约内读取版本和复验插件选择，避免发布并发安装中的不一致证据。
- 27c86a3: 让账号新增、编辑和删除共享原子运行态与配置文件事务，失败时恢复旧账号、内存配置和磁盘内容，并以 HTTP 409 拒绝并发配置变更。
- d35ccbc: 让配置热重载严格传播适配器、账号和协议的异步启动失败，并在失败后恢复旧运行态或同时报告回滚错误。
- 52d79c6: 在提交服务元数据前复验平台定义，并在安装失败时恢复旧服务或清理首次安装残留。
- 3b3c26d: 修正扩展中心对运行时能力证据的可信状态：插件版本未知时不再误报为已验证，并在保留清单浏览能力的同时明确提示该证据无法绑定到可归档的软件包版本。
- 7224ff5: 新增完整 Mattermost REST API v4 与可靠 WebSocket 适配器，支持已有 socket、manual ingress、严格事件投影、平台扩展动作、动态能力和可视化配置 Schema，并将其加入扩展能力目录。
- f6661b0: 新增能力清单白名单保护的平台扩展动作调用链，并让四种协议可调用适配器声明的扩展动作。Telegram 适配器补齐群管理、入群申请、文件、投票、转发、Reaction、置顶和邀请链接等原生能力，将完整 Update 统一投影且保留 raw_event。
- 13bfca1: 扩展目录为适配器与协议声明不同的配置目标；管理端分别进入账号创建和协议出口配置，并在新增账号时自动选中目标协议。
- 9a50312: 统一 ICQQ 标准动作与原生扩展动作的账号、连接、参数、资源和操作失败错误，并移除动作模块中的重复账号查找、裸错误与验证入口静默成功；同时公开核心错误分类，并让 Milky 按分类稳定投影参数与资源错误。
- ad2523d: 抽取 HTTP、本地文件、data URL 与 Base64 媒体来源的统一物化模块，并由 Discord 与 KOOK 共享。

  KOOK 发送图片、音频、视频和文件前会通过当前机器人上传素材，同时修正首次身份请求失败后账号无法自动恢复的问题。

- 3be2e2e: 通过固定 Prometheus 标签公开管理 WebSocket 的连接占用、容量和满载拒绝计数。
- d17db13: 主动公开跨进程软件包变更状态，并让扩展管理页与 doctor 在安装或更新期间展示可验证的事务证据。
- 2f0123f: 为 Adapter 工厂注册的 HTTP 与 WebSocket 路由建立候选回滚和生命周期所有权，避免无效或旧实例留下可达入口。
- 0d3b010: 让 doctor、status、启动更新验证与 Web 系统页只组合来自同一应用版本和进程实例的 `/health`、`/ready` 证据。
- 8a23b82: 并发执行 doctor 中相互独立的管理 HTTP、配置、运行态、能力与 WebSocket 探针，避免慢代理串行累加超时。
- 2c6671a: 将 Docker 与 Hugging Face 容器的扩展运行目录迁移到 `/data/extensions`，持久化 Web 扩展中心安装的依赖，并在启动时安全刷新镜像内置插件链接。
- bc6a29e: 让一键安装脚本使用主包匹配的 Web 依赖与固定默认协议版本，并在创建服务前验证两项运行产物。
- ee0b8d5: 让更新器从目标 OneBots 包读取扩展版本目录，并以共同验证的精确版本更新全部所选插件。
- d410cb5: 在导入扩展前拒绝绑定到另一份 `onebots` 或 `@onebots/core` 的插件，并把 Mock 适配器改为共享宿主运行时的 peer dependency。
- bce1fa0: 让服务启动与重启在进程管理器动作前验证已保存的 Node 和 OneBots CLI 入口，并使用该真实运行时隔离加载插件与校验配置。
- ddb32bd: `onebots install` 现在会在写入系统服务定义前，通过真实动态导入加载所选插件并执行完整运行时配置校验；import-only、初始化失败、未构建插件和无效账号配置会直接阻止安装，避免出现服务安装成功但启动必然失败的状态。
- b9c962a: `onebots start` 与 `onebots restart` 现在会根据已保存的服务工作目录重新加载插件并校验当前配置；预检失败时不会启动服务，重启预检失败时也不会先停止正在运行的实例。插件候选名解析已在前台运行、doctor 和服务预检之间统一。
- d38484c: 让 setup 与前台启动在写入配置前验证数据目录，避免错误挂载或权限问题留下半完成的首次部署状态。
- beef089: `onebots update` 现在会在依赖变更后通过更新后的 CLI 子进程执行隔离预检；只有新插件和当前配置验证成功后才改写服务定义并重启。预检失败会保留原服务定义与正在运行的实例，并返回可操作的失败原因。
- 1ffed04: 让非交互 setup 在保留已有配置时同时验证或创建运行数据目录，避免不可启动的存储路径被误报为就绪。
- aa89f81: 让只读能力查询在配置损坏时保留静态平台目录，并统一脱敏 CLI、JSON 与 doctor 中的配置解析诊断。
- 1a5c11c: 让 `onebots config set` 按基础 Schema 与现有字段类型解析值，避免数字形式的凭据和标识符被静默改成 number。
- 9ca94ae: 热重载失败时先重验候选配置身份，避免回滚覆盖另一进程已经写入的新配置。
- 5be37b3: 让前台运行完整保留 `-c` 指定的配置文件名，使管理、热重载、扩展与配置写回始终操作启动时选择的同一文件。
- c548700: 在启动配置损坏或不可读时继续发布扩展能力目录，显示脱敏诊断并在下载依赖前阻止安装。
- 454f528: 目标更新目录暂存现在会安全沿用运行目录的项目级 registry 配置，避免版本查询与下载使用不同镜像。
- 6b4e8d5: 通过受验证的 runner 无损传递 Windows 系统服务参数，并使用 WinSW 的真实服务 ID 控制生命周期。
- 1471cca: 让 Windows 用户级计划任务通过 Node runner 无损传递启动参数，并在卸载时清理服务定义与 runner。
- e3a0523: 为全部普通管理 API 响应和 Web 管理请求统一禁用缓存，避免复用旧运行态、配置或凭据响应。
- 6de06a7: 禁止管理页面发送 Referer，避免首屏查询鉴权码在脚本与样式加载期间随来源地址泄露。
- 2e2d50d: 将远程 canonical 路由限制在正式 Adapter 动作面，显式修复 `get_supported_actions` 调用，并拒绝会被 canonical 路由遮蔽的平台扩展动作。移除 HeyChat 频道管理与 LINE 退群动作的重复注册；这些能力继续通过对应 canonical 动作提供。
- d8a4c10: 让标准与 Hugging Face 容器入口以私有 umask 创建持久化文件，并在启动前验证配置权限为 `0600`。
- b83e594: setup 在已有配置中生成管理鉴权码时，将正式配置和备份同时收紧为 `0600`，避免新凭据继承原文件的宽权限。
- 486bb90: 为账号配置事务增加磁盘漂移检测与安全回滚，避免登录期间覆盖外部更新。
- 6cefa65: 让扩展变更回执使用事务自身的精确配置提交，并在依赖卸载期间重新启用扩展时恢复原依赖。
- 39ae2aa: 统一保护日志、账号验证和消息调试事件流，禁止缓存与内容转换，并关闭兼容反向代理的响应缓冲。
- 860d03c: 根管理与终端 WebSocket 现在会在协议升级前执行与 HTTP 管理 API 一致的动态 token 鉴权，未授权请求返回 HTTP 401。热重载管理凭据后会撤销全部会话与刷新令牌并关闭既有管理连接，避免旧凭据继续读取配置或执行控制动作。
- 62a4cfc: 以仅所有者可访问的权限创建运行时数据目录，并让 doctor 检测及修复可能泄露或允许替换数据库、审计和终端日志的目录权限。
- 061184f: 让 doctor 拒绝可被其他用户修改的 POSIX 服务定义，并让安装器原子恢复定义文件的 `0644` 权限。
- abc80df: 让 doctor 验证 POSIX 服务元数据权限，并允许用户级 `--fix` 将高风险模式恢复为 `0600`。
- 899d2f0: 以仅所有者可访问的权限创建服务状态目录，并让 doctor 检测及修复可能暴露服务日志或允许替换运行契约的目录权限。
- 8980ee8: 闭合 Web 重启请求的实例身份链。管理端现在携带预探测到的实例身份，服务端在预检前拒绝已被其他进程接管的过期请求，并返回应用、实例与调度状态；Web 只有验证完整回执后才等待新实例上线。
- 496f111: 分离在线主程序与 Core 版本身份：健康端点、Prometheus、系统信息和 Web 分别展示实际 `onebots` 与 `@onebots/core` 版本；doctor 会对比在线主程序与当前 CLI，版本漂移在严格模式下阻止部署。
- ae6ed2e: 安装或更新守护服务后按操作前后的权威进程状态提示启动、重启或状态验证操作。
- aad8f52: 将账号动态能力清单错误隔离为机器可读诊断，并在 Web 能力面板明确提示默认清单回退，避免单个第三方适配器错误破坏整个管理页。
- 1296ab9: 收紧官方 Docker 与 Hugging Face 镜像的运行权限：入口完成持久化卷初始化后降权到内置 `node` 用户，并在卷无法安全迁移时拒绝以 root 身份继续运行。
- 28a8ace: 将消息调试历史、实时事件流和清空回执绑定到同一运行实例，并通过清除序号边界正确处理迟到事件。
- b4dae78: 为扩展安装操作公开稳定的操作标识、开始时间和可观测阶段，并在 Web 扩展中心区分依赖安装与隔离预检进度。
- f321456: 管理端重启前复用守护服务预检，验证全部插件入口、注册契约与运行配置；失败时保留当前服务并在扩展页面显示具体诊断，避免进入重启崩溃循环。
- 49a5628: doctor 通过受保护扩展清单验证磁盘依赖与当前进程实际加载版本已经收敛。
- febbf02: 为健康探针增加脱敏的运行契约标识，并要求受管服务上线验证证明配置、插件与运行入口一致。
- d73471e: 要求守护服务预检使用配置文件中持久化的管理凭据，并让 doctor 明确报告临时 shell Secret 不会进入服务定义。
- 58cbc7b: 为协议实例增加由账号编排维护的生命周期状态，并让 `/ready`、Prometheus 指标与 `onebots doctor` 同时验证协议出口是否真正启动；空配置保持管理面可访问，但显式报告 `configured: false`。
- 78e2b18: 就绪检查现在要求每个已配置账号至少拥有一个协议出口；`/ready`、Prometheus 指标与 doctor 会直接报告缺少协议出口的账号数量，避免平台连接在线但无法向下游交付事件时被误判为可服务。
- c175a49: 在启动或重启命令产生副作用前重复验证服务控制面权限和平台定义，拒绝长预检期间发生的安全漂移。
- 329f109: 扩展停用现在发布稳定的活动操作与最近终态证据；管理页面在长预检请求断线或目录暂时不可读后会继续跟踪同一操作，并根据可信终态恢复重启或展示失败诊断。
- 0e99e8e: 改进扩展安装的断线与并发恢复。同一扩展的重复请求现在复用一个服务端安装操作，不同扩展继续互斥；扩展页会在服务端安装进行中自动刷新到最终成功或失败状态。
- aa14384: 为 Hugging Face 备份增加受信任扩展恢复清单与数据归档降级证据；归档超限时仍安全更新配置，并在新卷启动前按当前目录固定版本恢复扩展依赖。
- d337b12: 让 setup、前台创建和配置命令统一使用脱敏解析器，并允许 `setup --force` 在备份损坏 YAML 后从安全默认值重建配置。
- beda887: 为账号配置失败增加稳定错误码，并在表单来源失效时自动刷新可信快照。
- 4420334: 可归档的平台能力报告不再暴露运行时插件的绝对入口路径，同时保留兼容字段与包版本身份。
- 6165c44: 在配置解析器源头移除 YAML 源码片段，避免严格运行、服务预检、热重载和更新路径把相邻凭据写入诊断。
- 6b356f3: 更新器现在会在取得依赖写租约后重读插件选择与包版本，避免并发扩展安装被陈旧回滚快照覆盖。
- 50f7a9f: 在前台启动、doctor 与服务预检中拒绝缺少账号 ID 的已加载适配器配置键，避免手写平台凭据被静默忽略为零账号部署。
- a468bfe: 在扩展安装与更新前拒绝冲突、无效或不支持的包管理器证据，避免修改错误的依赖图。
- 7953c9a: 共享 Router 现在会拒绝重复的 HTTP 方法与精确路径，并在数组路径中的任一项冲突时原子撤销整次注册，避免后注册账号或扩展显示可用却始终无法收到回调。
- 12ee2e0: 禁止部署诊断、服务上线和更新门禁接受重定向后的健康与就绪探针身份。
- 7ab2d26: 阻止 setup 使用插件加载前的陈旧快照覆盖并发更新或新建的配置文件。
- f6c6930: 避免非交互 setup 在忽略未持久化的 `-r` / `-p` 插件变更后错误报告成功。
- ea14830: 让 `onebots config set` 在写盘前拒绝空路径段与原型链保留字段，避免配置路径歧义和对象原型污染。
- 2a0016a: 新增可复用的 `ReliableEventIngress`，统一事件并发合并、成功后提交和失败重投语义，并让 Teams、飞书与钉钉删除各自重复的投递状态机。

  让 LINE Webhook、`ingestHttp()` 与 manual `ingest()` 等待异步监听器和全部协议出口；投递失败不提交持久化去重状态，并发重投只执行一次且准确报告 duplicate。同步更新类型、Schema 提示、能力说明、README 与回归测试。

- f149bab: 配置热重载期间让 readiness 返回不可用并暴露重载指标，同时拒绝并发重载，避免编排系统向尚未完成切换的账号与协议出口转发流量。
- 14ed8a6: 在扩展中心识别版本一致但入口损坏或越界的依赖，并通过强制重新安装固定版本提供可操作修复。
- 3b3c3a1: 新增统一的包版本读取工具，并让 Discord、飞书/Lark、Slack 与 Telegram 的版本接口返回实际发布版本，不再固定报告 `1.0.0`。
- c9a4ea8: 在 doctor JSON 报告中结构化记录实际 API 与 Web 管理目标地址，便于部署归档直接核对探测范围。
- 371641a: 让一键安装器从已验证状态报告读取完整管理地址，保留自定义路径前缀，并在最终地址证据缺失时停止。
- f0a9cde: 让 doctor 在守护服务元数据损坏时继续生成脱敏的结构化报告，并以 `invalid` 服务模式阻止部署门禁误判。
- 1faf73d: 让主应用与优雅停机在尝试全部生命周期清理步骤后传播数据库、Router、HTTP 及扩展资源的释放失败，同时保留嵌入式调用默认的尽力清理兼容行为。
- 38eb759: 账号作用域内的 HTTP 与 WebSocket 路由冲突现在会同时报告正在注册和已占用路径的平台与账号，热重载失败时也会保留这些诊断并恢复旧账号路由。
- d45f99b: 让 `doctor --fix` 在用户级服务修复命令失败时继续返回完整的脱敏诊断报告。
- 957152a: 让 doctor 在 systemd、launchd 等平台服务定义无法读取时继续生成脱敏报告，并在 `--fix` 后重新验证实际写入结果。
- 5832766: 让 `onebots update --check` 通过稳定退出码区分无需更新、存在已验证更新与检查失败。
- 3941b1d: 恢复并规范化宿主 `path` 的 HTTP Router 前缀，使运行时路由、状态检查与 doctor 使用同一部署地址，同时拒绝不安全的路径值。
- fb93be0: 让重复安装仅在整组依赖通过预检后提交主包升级，失败时恢复旧 OneBots，并只在首次配置时安装默认协议。
- e42f385: 扩展安装或更新命令非零退出但已经改写包版本、依赖声明或锁文件时，自动恢复操作前的依赖状态，并在恢复失败时保留两段诊断。
- 55683a5: 插件注册契约失败后允许同一进程重新执行入口，避免 Node ESM 缓存让修复后的重试持续失败。
- 1d3fe9e: 让 MCP stdio 复用网关已经验证的协议入口，并在交接失败时完整停止已启动的应用资源。
- a0a7658: 管理凭据轮换时同步断开全部敏感 SSE，并在停机时统一清理流定时器与响应。
- 2b6e60b: 扩展包安装成功但后续预检或配置提交失败时，恢复安装前的依赖版本并保留回滚失败证据。
- 1f60104: 插件加载现在以串行注册事务执行。初始化抛错或未满足工厂与 Schema 契约时，会恢复导入前的适配器、协议、Schema 和协议版本元数据，避免失败插件污染后续启动、doctor 与服务预检。
- 61e5c69: 启动任一阶段失败时执行完整资源回滚并废弃半初始化实例；主应用同时释放日志文件监听、进程退出监听和标准输出拦截，回滚失败时保留启动与清理两类错误。
- 17398bb: 让仅依赖更新在保留新版本前执行隔离运行预检，并在失败时恢复更新前的完整依赖集合。
- d94db9b: 更新后的包版本校验或隔离预检失败时，在服务切换前恢复全部所选依赖的原始版本。
- 5de897a: 记录进程最近成功应用的配置文件快照，在管理 API、Web 系统页和 doctor 中检测磁盘配置尚未重载或重启的漂移状态。
- c234f7e: 保留已通过契约校验的插件包名、版本与实际入口，并在管理 API、Web 系统页和 doctor 中展示当前进程真正加载的扩展清单。
- d3c46d8: 让随包发布的 Web 管理端从动态 HTML 读取当前网关 HTTP 前缀，使登录、配置、扩展、探针与协议出口无需重新构建即可访问前缀路由。
- ea193f9: 将账号删除管理请求迁移到 POST JSON 契约，并为旧 GET 入口提供带弃用标记的兼容路径。
- e562744: 扩展安装在启用并写入配置前，以隔离子进程验证候选插件入口、注册契约与完整运行配置；预检失败不会污染持久化启动选择，并会对预检期间的并行配置修改重新合并验证。
- d424976: 为扩展中心增加停用重启后的可恢复依赖卸载，并在包管理器部分写入时恢复原精确版本。
- 18575c4: 扩展中心新增安全停用流程：先隔离预检移除插件后的候选配置，再原子更新启动选择并完成可验证重启；已安装依赖会保留，仍被账号或协议出口引用的扩展不会被停用。
- a3df262: 默认配置不再创建带空凭据的平台账号，首次启动可安全进入管理端后再添加账号；同时收紧 `doctor` 的运行时探测，健康或就绪端点返回非 2xx 时诊断失败，并在就绪报告中列出离线账号所在平台。
- 20a114f: 管理端重启预检改为在一次性 CLI 子进程中执行，避免失败预检污染在线进程的插件 Registry、加载清单和 ESM 模块缓存。
- 49fbce3: 启动或重启已安装服务前验证服务状态目录、元数据、平台定义及其父目录权限，发现高风险漂移时在调用进程管理器前终止操作。
- 393e28f: 为 `setup` 增加需与 `--force` 配合的 `--reset` 恢复入口，在已配置插件被卸载或配置无法继续复用时先备份原文件，再从安全默认值重建。
- b25ada5: 让 `onebots send` 在发送管理凭据前确认目标 OneBots 的版本和实例身份，并校验登录、发送响应与成功回执均来自同一实例。
- e0d1c0e: 为 setup 与无凭据首次启动生成持久化的 256 位管理鉴权码，并停止把初始管理秘密输出到服务日志。
- 839d91b: 在安装、诊断和状态检查中验证服务定义父目录不可被其他用户用于路径替换，并在原子写入前重复执行同一安全门禁。
- 6070cf8: 让 `onebots status` 持续发布持久化管理凭据的 POSIX 权限证据，并在配置、备份或父目录出现高风险权限漂移时拒绝把健康进程报告为生产就绪。
- 4a55c2a: 让 SQLite 以仅所有者可访问的权限创建目录和数据库，并让 doctor 独立验证数据库文件及实际父目录的权限边界。
- bf2f2fb: 串行化同一账号的跨传输生命周期操作，并让 Web 保留和展示服务端返回的稳定失败证据。
- 85f2191: 将管理 WebSocket 动作改为初始快照后的有界顺序处理，避免启动窗口丢消息与并发状态变更。
- be87f27: 管理终端日志改用进程级单层标准流分发，使多个应用实例可按任意顺序停止而不会残留失效拦截器或重复缓存输出。
- bdafc09: 让扩展运行根、包管理器、服务入口与更新目标共享有界且规范化的 package.json 读取边界。
- 0141cea: 抽取代次安全的异步凭证缓存、有序受控并发与统一 API 路径校验，供多个适配器复用；企业微信与微信客服不再因旧请求的迟到错误清空新 token，并拒绝路径内嵌 query/fragment，同时将企业微信菜单与模板卡片回调投影为统一交互事件。
- 2858c9f: 扩展清单提前发布运行目录身份错误，Web 在安装前显示原因并禁用无效操作。
- 9665836: 按 Telegram `allowed_updates` 与 Zulip `event_types` 展示账号真正可达的事件能力，并提供可复用的账号事件能力收窄工具。
- 48bfe11: 让管理 API 与机器人页在尚未配置账号时也展示已加载适配器的默认能力和插件版本，并明确标记未声明能力的第三方插件。
- 1ef6488: setup 完成后输出 Web 管理地址，并在 `PORT` 覆盖配置时分别说明前台与守护服务入口。
- 335375b: 修复应用热重载清理宿主资源、重复注册路由与账号启动未等待的问题，并拆分可观测性和静态目录模块。
- 88d3f2e: 为 `capabilities --json` 增加可跨主机和生成时刻比较的稳定 SHA-256 能力证据摘要。
- 32a908e: `onebots status` 现在会在进程运行时探测 `/health` 与 `/ready`，区分“已就绪”“待配置”和“不可用”；服务未运行或探针失败返回退出码 1，未安装返回 2，使状态命令可直接用于部署与监控脚本。
- bacfbc7: 新增可等待全部协议完成的 `Account.dispatchAwaited()`，协议广播会尝试并等待全部投递出口，反向 HTTP/Webhook 失败可反馈给可靠事件入口；钉钉与飞书统一等待异步监听器、合并并发重投，并仅在协议投递成功后确认和提交去重状态。钉钉与飞书缺少原生事件 ID 时改用确定性载荷身份。
- e8926ce: 让 `onebots update` 与 Web 扩展安装共享跨进程包变更租约，并为更新、恢复和隔离预检设置明确超时，避免并发写入和交错回滚。
- cd488ed: 服务配置路径或控制面权限不可信时停止状态 HTTP 探测，避免把可篡改目标的响应混入生产证据。
- 1bb83e0: 将管理终端日志缓存统一存放到配置同级的数据目录，避免守护服务与前台进程因工作目录不同而写入不同位置。
- 9a5ca9b: 让 doctor 通过独立检查验证账号能力诊断契约，并在任一账号能力证据不可用时使生产门禁失败，同时保留账号与协议生命周期的独立结论。
- 34cccc4: 就绪端点与 Prometheus 指标现在会验证磁盘配置是否仍与当前运行版本一致；配置漂移、文件不可读或等待重启时返回 HTTP 503，doctor 会给出对应原因，避免编排系统继续把不可安全重启的实例视为就绪。
- 02f1f17: 新增可复用的声明式 HTTP 平台动作契约，统一校验字段、类型、范围、条件必填、对象数组及 POST query/body；KOOK 迁移到该公共契约，Heychat 的 36 个官方动作按领域拆分并关闭任意参数透传。
- e7774a7: 新增可复用的平台动作参数契约注册器，并让微信客服命名动作严格拒绝未知字段及类型错误的可选参数。
- 1b02635: 插件动态导入后会继续验证 CLI 名称对应的适配器或协议工厂及配置 Schema 已完成注册；setup、doctor、前台启动与服务预检会立即拒绝空入口、错误注册名称和缺失 Schema，并给出具体诊断。
- e7f17c5: 为 `onebots doctor` 增加 `--strict` 生产门禁模式：任一诊断警告都会令报告失败、JSON `ok` 为 `false`，并返回退出码 1；已安装但停止的服务现在会明确标为警告，默认首次配置行为保持不变。
- a3df262: 新增统一的运行时配置预检：启动、doctor、Web 配置保存和热重载现在会按已加载适配器与协议注册的 Schema 校验平台凭据、继承后的协议参数和插件引用，并以完整配置路径报告错误；无效配置不再静默忽略账号或写入配置文件。
- 740bb95: 修正 ConnectionManager 首次连接失败后不再重连的问题，并隔离停止或重启前的旧连接结果。

  修正 Discord Gateway 的 Resume 握手、远端正常关闭恢复和延迟任务清理，并提供受控的完整 Discord v10 REST API 入口。

- 6a88f9f: 抽取可等待的 EventEmitter 投递与按键单航班基础设施；企业微信 Webhook 现在等待异步监听器、合并并发重试，并补齐日历、日程与审批平台动作。
- 46ca10c: 补齐 Milky 会话置顶、群公告、群精华与永久群文件动作，并统一参数、能力与未知 API 的结构化错误响应。
- f72e8e2: 一键安装在服务预检前同步配置中所有已选扩展的验证版本，避免重复安装留下旧插件。
- 99d5201: 增加一键安装脚本和 Web 功能扩展中心。安装脚本自动准备 Node.js 24、Web 管理端、默认协议与用户级常驻服务；管理端可从官方白名单安装适配器或协议、持久化启动选择、自动重启，并按平台 setup 流程引导完成凭据与账号配置。
- ab4fe3c: 保留扩展最近一次安装终态和脱敏诊断，使重连或多页面场景仍能识别失败原因与对应操作。
- 10361de: 修复 Web 扩展中心在 pnpm workspace 中误用 npm 安装扩展、因 `catalog:` 清单字段失败的问题。安装器现在根据运行目录选择 npm 或 pnpm，并在调用 npm 时移除继承自 pnpm 的无效环境配置警告。
- ff55a25: 为 Web 扩展安装增加运行目录级跨进程租约，避免多个 OneBots 实例交错改写依赖、锁文件或回滚结果，并安全回收崩溃遗留租约。
- 7477300: 在仓库首页增加按协议分组的 API 与平台支持矩阵，并使用协议动作目录和适配器能力清单自动校验内容。
- 9fffc1a: 卸载守护服务前等待进程管理器确认停止，失败时保留平台定义与私有元数据。
- a1da064: 统一 HTTP 与旧管理 WebSocket 的账号生命周期执行边界，让畸形请求、缺失目标、未实现能力和插件故障都返回稳定且可关联的失败证据。
- 3ad5383: 根管理 WebSocket 的 `system.saveConfig` 与 `system.reload` 现在复用 HTTP 配置事务、并发锁与验证器，并通过 `system.config.result` 返回可关联的成功或错误回执。可选远端备份失败不再把已生效配置误报为保存失败。
- 83490a7: 统一由平台动作注册表派生不可变能力描述，保留各平台权限、上下文与场景差异，避免动作实现、Web 能力展示和支持动作查询发生漂移；微信公众号原生语言参数查询改用不与 canonical 动作冲突的 `get_wechat_user_info`。
- 3d99a6f: 提供显式读取底层依赖 package.json 版本的公共入口，并让钉钉与 ICQQ 删除最后两套重复包元数据解析逻辑，同时继续准确报告 SDK 版本。
- a61d820: 统一更新与扩展安装的包管理器调用，清理 npm 继承的 pnpm 配置，并避免项目更新恢复开发依赖。
- 8432713: 在单账号新增和编辑进入运行态前校验非空身份及完整插件 Schema，并让管理 API 以 HTTP 400 返回无效账号配置。
- fd00708: 运行时配置校验现在要求每个账号至少配置一个已加载的协议出口，并在启动、Web 保存、热重载、setup 与 doctor 共用的校验阶段返回带账号路径的错误，避免先连接平台再通过 readiness 才发现账号无法向下游交付事件。
- 8fc9573: 统一账号配置键与路由身份校验，在 Web、账号 API、启动、热重载、doctor 和服务预检进入扩展前拒绝空身份及会改变 URL 语义的字符。
- 23346d5: 在 Hugging Face 数据归档打包与覆盖 `/data` 前验证相对路径、常规条目、数量与展开大小；恢复过程限制处理超时，并通过隔离目录预检目标后私有写入。
- 0604bda: 让非交互 setup 在保留已有配置时先验证配置与所选插件，避免损坏文件被误报为已就绪。
- 282e8e5: 在调用原生 PTY 前校验终端输入与尺寸，并在 PTY 退出后关闭客户端连接以触发可靠重连。
- 7f34ccd: 更新器现在只接受 registry 与目标目录提供的精确 SemVer，并会脱敏和限制目标包暂存失败诊断，避免凭据随原始 stderr 进入日志。
- b8475c0: 在 Web 合并零账号能力证据前深度校验清单、声明状态、版本绑定、平台唯一性与完整性结论。
- d6b9f53: 在扩展目录和包变更租约进入安装决策前校验身份、版本、能力摘要与状态闭合，并原子采用两份响应。
- b26322f: 将扩展中心的能力快照和安装目标绑定到同一个验证版本。所有目录适配器与协议现在公开验证版本和已安装版本，安装器使用精确版本并校验落盘结果；管理端会提示版本偏离，并允许切换回当前 OneBots 验证的版本。
- 10d462d: 为适配器能力目录发布标准实例身份头，并在 Web 与 doctor 中闭合响应头、正文和运行实例证据。
- 157b42f: 让 doctor 验证配置文件实际父目录不能被组或其他用户写入，防止仅依赖文件权限时配置路径仍可被替换。
- 889445a: 在 POSIX 部署检查中验证符号链接配置的入口目录，避免安全目标文件掩盖可被其他用户替换的配置链接。
- b6f422c: 为完整配置保存增加稳定错误码与可验证操作回执，并在 Web 读取正文前闭合响应实例和应用状态。
- f850284: 验证配置路径中所有符号链接组件的入口目录，阻止可写父目录替换配置的祖先路径。
- 103a6fd: 拒绝空数据库路径，并让 doctor 验证解析后的实际 SQLite 文件及父目录，将绝对路径和逃离默认数据目录的相对路径纳入部署门禁。
- 25d7b92: 容器 readiness 探针现在要求在线实例版本与镜像内 OneBots 主包完全一致，避免旧实例或错误路由被报告为健康。
- 0cfc799: 让 doctor 验证运行时数据路径的目录类型与读写能力，并在 JSON 目标上下文中记录实际数据目录，提前发现错误挂载和权限问题。
- 6dd6abb: 让 doctor 以当前发布目录为基准验证在线扩展闭集、静态身份、能力快照与安装操作证据。
- d75c0e8: 让 doctor 在同一在线实例身份边界内验证 Web 管理页，并归档 `management-page` 证据。
- 6ff9be5: 让 doctor 使用与网关相同的实际监听方式验证空闲端口，避免遗漏其他网卡、IPv6 占用或绑定权限错误。
- f9ce4cf: 让 doctor 与 JSON 诊断验证全部扩展配置目标，并逐项报告目录漂移。
- da99b42: 在扩展清单、安装入口和 doctor 中提前验证运行目录所需的 npm 或 pnpm 可执行入口，并允许已安装且版本匹配的扩展在缺少包管理器时继续启用。
- 3449a73: 扩展安装前校验目标目录的 OneBots 依赖身份与运行版本，避免修改无关项目或错版本运行时。
- 3670e84: 校验扩展目录中的包名身份，并在扩展中心展示损坏或被替换的依赖清单。
- 6e02513: 修复 macOS 服务停止后可能被 launchd 自动重新拉起的问题，并让 CLI 与终端面板只在进程管理器确认服务停止后报告成功。
- 3c8e65d: 非交互 setup 不再把缺少管理凭据的已有配置误报为就绪，启动入口自动补齐鉴权码时也会将配置与备份收紧为 `0600`。
- f99ae64: 让 doctor 验证管理 API 发布的默认与账号级适配器能力契约。
- 43dbe29: 让 `onebots status` 在线验证 Web 管理页、当前 Router 前缀和入口安全响应头；一键安装仅在管理页确实可打开时报告完成。
- dbb154f: 让一键安装在宣告成功前等待托管服务通过在线状态门禁，避免启动失败、错误版本或 readiness 异常时仍显示管理地址与首次鉴权码。
- e8f3f9f: 让 doctor 独立验证在线实例发布的全平台能力目录、应用身份、官方平台闭集、固定版本与派生摘要，并将无法绑定包版本的运行时能力明确降级为未知证据。
- 9912261: Doctor 现在会核对在线实例实际使用的配置与数据路径，避免同端口上由另一份配置启动的进程被误判为当前部署。
- aaa44ca: 在扩展依赖下载前执行并验证实际 npm 或 pnpm 入口的版本，同时让 doctor 归档该版本并拒绝过旧、异常或不可执行的包管理器。
- 37322c8: 收紧服务切换前的实例身份采集，只接受健康且运行契约与已安装服务一致的 OneBots 进程。
- 5f983f9: 让运行时与 doctor 共享站点静态目录的真实路径检查，并在诊断报告中公开、修复和验证最终目录。
- 70f57f1: 发布门禁现在检查最终 npm tarball 的依赖版本，阻止 `catalog:`、`workspace:` 等本地协议进入制品并导致扩展安装失败。
- e100e9d: 重复安装失败并恢复旧主程序后，使用真实配置再次隔离预检恢复后的完整运行环境，避免仅凭版本号误报恢复成功。
- ea02e1c: 启动或重启服务前确认配置文件身份、内容与权限仍和运行时预检一致，拒绝预检后的配置替换或安全漂移。
- b4900e3: 在安装、启动和重启守护服务前验证持久化管理凭据的文件、备份与父目录权限。
- f2f3d86: 让 doctor 验证守护服务入口实际属于当前版本的 onebots 包且与 `bin.onebots` 声明一致，避免已停止服务继续引用旧版或替代脚本。
- 5d13602: 为健康端点发布进程实例身份，并让服务启动与重启在新实例通过在线验证后才报告成功。
- b01a43b: 让 doctor 执行并验证守护服务定义实际保存的 Node.js，拒绝不可执行或低于 Node 24 的运行时，并允许用户级 `--fix` 切换到当前 Node。
- 1965daa: 让 doctor 验证服务状态路径确实是可遍历、读写的目录，并以脱敏错误拒绝文件占位或不可用路径。
- 54656da: 让 `onebots status` 校验在线主程序版本：旧进程、旧健康端点或错误运行入口不再被报告为已就绪，并以退出码 `1` 阻止轻量部署门禁继续。
- 1cf6fd0: 在 setup 复用持久化管理凭据前验证配置、备份和父目录权限，避免把公开凭据误报为安全就绪。
- e432abf: 在 setup 输出配置就绪前复验写后文件内容、真实路径与凭据权限，避免并发替换或权限漂移被误报为成功。
- d2dcc54: 让 `onebots status` 验证已安装服务配置仍包含持久化管理凭据，避免当前健康但重启后失去鉴权的服务继续被报告为生产就绪。
- 0e4b4ff: 让 `onebots status` 持续验证服务状态目录、元数据和平台定义权限，避免可被其他用户读取或篡改的服务控制面继续被报告为生产就绪。
- 9a66d16: 让服务状态同时验证已保存的 Node 与 OneBots CLI 入口，并拒绝把无法再次启动的健康旧进程报告为已就绪。
- 5a91e42: 让 `onebots ui` 的启动、停止和重启操作复用公开 CLI 服务边界，使终端面板同样执行配置预检、在线版本与实例切换验证，并保留失败证据。
- 781a17a: 在更新依赖前验证 OneBots 项目身份与可写性，避免从 Core 消费项目启动时修改错误目录。
- 462fff3: 让更新器在服务切换前逐包核对实际落盘版本，兼容项目与全局 CLI 安装根；包缺失或版本偏离时保留完整期望/实际证据并阻止预检、定义改写和重启。
- cbd7c9e: 让托管服务更新形成在线验证闭环：重启后等待 `onebots` 应用身份、目标版本与 readiness 证据，失败时保留最终探针诊断；延迟重启时明确提示旧实例仍在运行。
- cc540c2: 让 Web 在发送登录与刷新凭据前验证公开 OneBots 身份，并拒绝重定向或跨实例认证回执。
- 0101b35: 让 doctor 从真实 WinSW 文件验证 Windows 系统服务定义，修复安装后永久误报并识别启动契约漂移。
- 69fe867: 让 Windows 用户级服务原子写入并验证任务计划 XML 与实际 runner，发现缺失或被篡改的启动命令。
- 656bdfb: 为 capabilities 输出增加版本化证据 envelope，记录 OneBots 版本、配置路径以及适配器选择来自 CLI、配置或完整目录。
- 0b21841: 为 doctor JSON 增加版本化报告 envelope，记录生成时间、CLI 身份、配置与扩展目标、服务模式及结构化插件选择来源，便于 CI 留档追溯。
- 739d834: 将仓库首页协议能力矩阵的平台表头改为垂直排列，减少宽表横向占用。
- 30f9679: 扩展中心现在会在安装适配器和创建账号前展示绑定包版本的能力目录快照；插件加载后自动切换到运行时注册清单，并通过生成器与测试防止目录和适配器能力静默漂移。
- 7e38b87: 在账号运行态、Web 管理端和 doctor 中展示每个协议出口的身份、路径与生命周期，便于定位账号在线但协议启动失败的问题。
- 3d87c88: 修复 Docker 降权后扩展安装仍继承 root 主目录的问题，并为非 root 网关提供预先准备的共享 Corepack 缓存。
- Updated dependencies [4fb5a8b]
- Updated dependencies [022aa80]
- Updated dependencies [6716778]
- Updated dependencies [d19d9a6]
- Updated dependencies [a43a80e]
- Updated dependencies [d4acf1d]
- Updated dependencies [7de9672]
- Updated dependencies [5ace043]
- Updated dependencies [8451a27]
- Updated dependencies [42dc286]
- Updated dependencies [d7eccb8]
- Updated dependencies [fb1a96d]
- Updated dependencies [fb45ed6]
- Updated dependencies [1b843b1]
- Updated dependencies [b688f78]
- Updated dependencies [18ea42b]
- Updated dependencies [fd26734]
- Updated dependencies [9cf5b5f]
- Updated dependencies [5c55740]
- Updated dependencies [6638635]
- Updated dependencies [d28e16c]
- Updated dependencies [8903cca]
- Updated dependencies [422c5dc]
- Updated dependencies [caac8eb]
- Updated dependencies [47dec1e]
- Updated dependencies [16baf4b]
- Updated dependencies [fe109c2]
- Updated dependencies [fdf0dec]
- Updated dependencies [650faf3]
- Updated dependencies [f22eab6]
- Updated dependencies [814da1c]
- Updated dependencies [4fee4cb]
- Updated dependencies [a3a22b4]
- Updated dependencies [b89cc37]
- Updated dependencies [9c9c2f9]
- Updated dependencies [a472a9d]
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
- Updated dependencies [410dfb9]
- Updated dependencies [c495e37]
- Updated dependencies [0e1b962]
- Updated dependencies [03e196a]
- Updated dependencies [f4c648f]
- Updated dependencies [4f510a1]
- Updated dependencies [4383e38]
- Updated dependencies [e7c4d95]
- Updated dependencies [9806c68]
- Updated dependencies [c3d1cf4]
- Updated dependencies [e1d5678]
- Updated dependencies [dfa50e7]
- Updated dependencies [71fdd97]
- Updated dependencies [ef7d86b]
- Updated dependencies [e69ebfc]
- Updated dependencies [9e70080]
- Updated dependencies [a13c7e0]
- Updated dependencies [5d0ee5f]
- Updated dependencies [cee3510]
- Updated dependencies [9763f8f]
- Updated dependencies [86ab690]
- Updated dependencies [44de2fd]
- Updated dependencies [543a02c]
- Updated dependencies [0fd3b1b]
- Updated dependencies [e4a2c30]
- Updated dependencies [cef5489]
- Updated dependencies [a76a59b]
- Updated dependencies [31a5f8d]
- Updated dependencies [fe08d63]
- Updated dependencies [e03f801]
- Updated dependencies [41199e5]
- Updated dependencies [20bb9d2]
- Updated dependencies [27b72e3]
- Updated dependencies [5ebc795]
- Updated dependencies [4a49b75]
- Updated dependencies [b67d335]
- Updated dependencies [6a92444]
- Updated dependencies [99ff290]
- Updated dependencies [42b8ade]
- Updated dependencies [1a5dbb7]
- Updated dependencies [3739db4]
- Updated dependencies [ab9e08f]
- Updated dependencies [4c27657]
- Updated dependencies [0f4acc0]
- Updated dependencies [783051c]
- Updated dependencies [c2bbba4]
- Updated dependencies [7f0d5c8]
- Updated dependencies [1615e73]
- Updated dependencies [a5e99c0]
- Updated dependencies [5591c34]
- Updated dependencies [a5c4f96]
- Updated dependencies [1a65be7]
- Updated dependencies [34b2d31]
- Updated dependencies [3f5df08]
- Updated dependencies [046e50e]
- Updated dependencies [df5bd43]
- Updated dependencies [cf439fc]
- Updated dependencies [2408c76]
- Updated dependencies [0de01b3]
- Updated dependencies [59300db]
- Updated dependencies [27c86a3]
- Updated dependencies [d35ccbc]
- Updated dependencies [3b3c26d]
- Updated dependencies [072b9c8]
- Updated dependencies [f6661b0]
- Updated dependencies [74bbc4b]
- Updated dependencies [ae6dbf5]
- Updated dependencies [13bfca1]
- Updated dependencies [24893a8]
- Updated dependencies [ad2523d]
- Updated dependencies [776a285]
- Updated dependencies [1551f62]
- Updated dependencies [14b06b0]
- Updated dependencies [3be2e2e]
- Updated dependencies [d17db13]
- Updated dependencies [2f0123f]
- Updated dependencies [7ce4eac]
- Updated dependencies [0d3b010]
- Updated dependencies [a950886]
- Updated dependencies [5be37b3]
- Updated dependencies [c548700]
- Updated dependencies [e3a0523]
- Updated dependencies [6de06a7]
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
- Updated dependencies [aad8f52]
- Updated dependencies [28a8ace]
- Updated dependencies [b4dae78]
- Updated dependencies [f321456]
- Updated dependencies [febbf02]
- Updated dependencies [58cbc7b]
- Updated dependencies [78e2b18]
- Updated dependencies [329f109]
- Updated dependencies [0e99e8e]
- Updated dependencies [aa14384]
- Updated dependencies [beda887]
- Updated dependencies [2b9c998]
- Updated dependencies [97bdc89]
- Updated dependencies [7953c9a]
- Updated dependencies [2a0016a]
- Updated dependencies [f149bab]
- Updated dependencies [14ed8a6]
- Updated dependencies [3b3c3a1]
- Updated dependencies [1faf73d]
- Updated dependencies [38eb759]
- Updated dependencies [3941b1d]
- Updated dependencies [2b6e60b]
- Updated dependencies [1f60104]
- Updated dependencies [61e5c69]
- Updated dependencies [5de897a]
- Updated dependencies [c234f7e]
- Updated dependencies [d3c46d8]
- Updated dependencies [ea193f9]
- Updated dependencies [d424976]
- Updated dependencies [18575c4]
- Updated dependencies [0ca53d8]
- Updated dependencies [4a55c2a]
- Updated dependencies [bf2f2fb]
- Updated dependencies [0141cea]
- Updated dependencies [32659bc]
- Updated dependencies [2858c9f]
- Updated dependencies [9665836]
- Updated dependencies [48bfe11]
- Updated dependencies [100bfb0]
- Updated dependencies [12c8adf]
- Updated dependencies [557b1b1]
- Updated dependencies [335375b]
- Updated dependencies [bacfbc7]
- Updated dependencies [2b2361b]
- Updated dependencies [866c32d]
- Updated dependencies [dca581b]
- Updated dependencies [7506409]
- Updated dependencies [4477055]
- Updated dependencies [85f3c34]
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
- Updated dependencies [1e33306]
- Updated dependencies [99d5201]
- Updated dependencies [ab4fe3c]
- Updated dependencies [9ed209b]
- Updated dependencies [0d082ec]
- Updated dependencies [83490a7]
- Updated dependencies [3d99a6f]
- Updated dependencies [6bf71c2]
- Updated dependencies [8432713]
- Updated dependencies [341bb56]
- Updated dependencies [8fc9573]
- Updated dependencies [45cbd06]
- Updated dependencies [282e8e5]
- Updated dependencies [b8475c0]
- Updated dependencies [d6b9f53]
- Updated dependencies [b26322f]
- Updated dependencies [10d462d]
- Updated dependencies [b6f422c]
- Updated dependencies [103a6fd]
- Updated dependencies [da99b42]
- Updated dependencies [3670e84]
- Updated dependencies [e8f3f9f]
- Updated dependencies [5f983f9]
- Updated dependencies [5d13602]
- Updated dependencies [cc540c2]
- Updated dependencies [3b37442]
- Updated dependencies [0720e45]
- Updated dependencies [30f9679]
- Updated dependencies [7e38b87]
- Updated dependencies [66107f6]
- Updated dependencies [4771868]
- Updated dependencies [6ae74a5]
- Updated dependencies [d3b1ce8]
- Updated dependencies [7da1989]
- Updated dependencies [c884f81]
  - @onebots/core@1.2.6
  - @onebots/web@1.0.14

## 1.2.8

### Patch Changes

- 9cc0622: 闭合好友申请事件与处理能力链路，并为 Milky V1、OneBot 11 和 OneBot 12 提供保留原始申请凭据的同意好友申请 API。
- c9e876c: 建立统一的 Adapter 能力清单与结构化能力错误，修复 Teams、Mock 和企业微信事件投递，并复用微信生态回调验签、解密与 XML 解析实现。
- a87f07a: 闭合 Milky 与 Satori 的原生协议契约，修复各 SDK 在 OneBots 兼容模式下的 WebSocket 地址，并让 Web 配置表单优先使用协议包注册的完整 Schema。
- f1493f6: 删除 Web 包中不可达的旧版 imhelper 副本与无效兼容类型；由协议 Schema 声明表单语义分区，并通过统一布局模块生成协议配置界面。
- 78c1e50: 统一 SDK 地址语义并移除隐式 OneBots 路由兼容逻辑；为协议 Schema 增加事件过滤器元数据，在 Web 配置页提供可增删的可视化规则编辑器与高级 JSON 模式。
- 03cc74d: 为 Milky、OneBot 11 和 OneBot 12 增加统一的 `invite_friend_to_group` 扩展 API，并通过通用 Adapter 能力调用 ICQQ 的原生好友入群邀请。
- Updated dependencies [9cc0622]
- Updated dependencies [c9e876c]
- Updated dependencies [844a041]
- Updated dependencies [f1493f6]
- Updated dependencies [78c1e50]
- Updated dependencies [03cc74d]
  - @onebots/core@1.2.5
  - @onebots/web@1.0.13

## 1.2.7

### Patch Changes

- Updated dependencies [25ac8a4]
  - @onebots/web@1.0.12

## 1.2.6

### Patch Changes

- 7891a2e: 丰富协议配置 Schema 的表单元数据，在 Web 管理端为 Webhook 与反向 WebSocket 提供动态增删和单项高级设置，并移除全局表单中的账号重复配置。
- Updated dependencies [7891a2e]
  - @onebots/core@1.2.4
  - @onebots/web@1.0.11

## 1.2.5

### Patch Changes

- 41f4bcc: 改进 Web 配置、日志与验证管理，补充 MCP 和协议格式测试，并收紧核心、适配器及协议实现的公开类型。四个客户端 SDK 的事件扩展字段和默认响应数据由 `any` 收紧为 `unknown`，调用方需先进行类型收窄。
- Updated dependencies [41f4bcc]
  - @onebots/web@1.0.10
  - @onebots/core@1.2.3

## 1.2.4

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

## 1.2.3

### Patch Changes

- 1f79a8a: 修复 pnpm 全局安装后 CLI 因 `@inkjs/ui` 未声明 `react` 依赖而报 `Cannot find package 'react'`（`onebots -h` 等命令无法启动）。

## 1.2.2

### Patch Changes

- 4fd55a6: 登录验证与配置 Schema 体验修复：
  - 微信 ClawBot 二维码过期自动换码后推送到 Web 并更新 UI；登录成功清理待处理验证
  - ICQQ 将 `login_error` / `offline` 的 message 推送到验证面板，提供「重新登录」等快捷操作；扫码 / 身份验证 / 设备锁统一「已完成，继续登录」
  - `VerificationRequest` 新增 `actions`、`confirmLabel`，网关支持 `verification:clear`
  - 配置 Schema 彻底用 `choices` 替代 `enum`（含中文选项）；object 字段（如 `log_config`）留空不再默认写成 `{}`
  - 拦截 ICQQ SSO 心跳等未处理 Promise rejection，避免拖垮进程；网络闪断依赖自动重连、不误推重登；微信轮询瞬态网络错误降级为 warn

- Updated dependencies [4fd55a6]
  - @onebots/core@1.2.2
  - @onebots/web@1.0.9

## 1.2.1

### Patch Changes

- 0519d6d: Replace the nested gateway/service CLI with a Pastel-powered flat single-service interface, add setup, UI, doctor, and update commands, and delegate process supervision to native operating-system service managers.
- d9e67a0: feat(adapter-heychat): 新增黑盒语音官方机器人适配器
  - WebSocket 长连接、心跳与自动重连
  - 斜杠命令 (type=50) 与普通频道消息 (type=5，实验性)
  - 频道消息发送/删除与房间信息查询

- fa90690: Build development workspace dependencies before startup, deduplicate repeated plugin flags, and report missing plugin build output as one actionable diagnostic.
- Updated dependencies [922a341]
- Updated dependencies [15b2540]
- Updated dependencies [15b2540]
- Updated dependencies [15b2540]
  - @onebots/core@1.2.1
  - @onebots/web@1.0.8

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

### Patch Changes

- Updated dependencies [4564d68]
  - @onebots/core@1.2.0

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

### Patch Changes

- Updated dependencies [d9fdbd5]
  - @onebots/core@1.1.0

## 1.0.7

### Patch Changes

- b00497a: fix: 调整发布流程,做首次release
- Updated dependencies [b00497a]
  - @onebots/core@1.0.6
  - @onebots/web@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [ee4e625]
  - @onebots/core@1.0.5
  - @onebots/web@1.0.6

## 1.0.5

### Patch Changes

- 4465ece: Web 管理端 `/api/config/schema` 合并适配器配置预设：在未使用 `-r` 加载 `wecom-kf`、`icqq` 等包时仍可提供表单项；并补充 line、email、whatsapp、zulip、mock 的预设。账号管理页平台字段改为可搜索下拉并支持手动输入。

  Docker / HF 镜像与 `development` 的 `pnpm dev` 默认增加 `-r wecom-kf`、`-r icqq`（镜像需在构建阶段用 `NODE_AUTH_TOKEN` 装好 `@icqqjs/icqq`，启动后无需 token）。`development` 增加对 `@onebots/adapter-icqq` 的 workspace 依赖以便解析。

- Updated dependencies [4465ece]
  - @onebots/web@1.0.5

## 1.0.4

### Patch Changes

- 2645ccf: 新增全局配置 `public_static_dir`：托管站点根静态文件（如企业微信可信域名校验 txt）；Docker / HF 入口脚本创建 `/data/static` 便于与配置一并持久化；Web 管理端「配置 → 站点静态」支持列表、上传与删除；`koa-body` 启用 multipart（单文件 ≤2MB）。在 Hugging Face Space 等已配置 `HF_TOKEN`、`HF_REPO_ID` 时，上传/删除站点静态文件后会自动调用 HF commit 接口，重新打包提交 `config_backup.yaml` 与 `data_backup.tar.gz`（含 static）。
- Updated dependencies [2645ccf]
  - @onebots/core@1.0.4
  - @onebots/web@1.0.4

## 1.0.3

### Patch Changes

- 5d3787b: fix: v1.0.1
- Updated dependencies [5d3787b]
  - @onebots/core@1.0.3
  - @onebots/web@1.0.3

## 1.0.2

### Patch Changes

- 78d4de2: fix: bump version
- Updated dependencies [78d4de2]
  - @onebots/core@1.0.2
  - @onebots/web@1.0.2

## 1.0.1

### Patch Changes

- 4f7255b: chore: 切换到 npm OIDC 可信发布
  - 移除 NPM_TOKEN 依赖
  - 使用 GitHub OIDC + Provenance 发布
  - 所有 25 个包已配置 Trusted Publishers

- Updated dependencies [4f7255b]
  - @onebots/core@1.0.1
  - @onebots/web@1.0.1

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
  - @onebots/core@1.0.0
  - @onebots/web@1.0.0
