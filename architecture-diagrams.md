# onebots 架构图

本文档包含 onebots 项目的各种架构图，使用 Mermaid 语法编写。

## 导出图片的方法

### 方法 1: 使用 Mermaid Live Editor
1. 访问 https://mermaid.live/
2. 复制下面的 Mermaid 代码
3. 粘贴到编辑器
4. 点击右上角下载按钮导出为 PNG/SVG

### 方法 2: 使用 VS Code 插件
1. 安装 "Markdown Preview Mermaid Support" 插件
2. 预览本文档
3. 右键图表 → 导出图片

### 方法 3: 使用 Mermaid CLI
```bash
npm install -g @mermaid-js/mermaid-cli
mmdc -i architecture-diagrams.md -o output.png
```

---

## 1. 整体架构图

```mermaid
graph TB
    subgraph Client["客户端层"]
        HTTP_Client["HTTP 客户端"]
        WS_Client["WebSocket 客户端"]
        Webhook["Webhook 接收端"]
    end

    subgraph App["应用层 (App)"]
        Config["配置管理<br/>config.yaml"]
        Router["路由管理<br/>HTTP/WebSocket Server"]
        Logger["日志系统"]
        AdapterMgr["适配器管理器"]
    end

    subgraph Protocol["协议层 (Protocol)"]
        OB11["OneBot V11<br/>- HTTP/WS 服务端<br/>- HTTP/WS 客户端<br/>- 事件转换<br/>- API 映射"]
        OB12["OneBot V12<br/>- HTTP/WS 服务端<br/>- Webhook<br/>- 事件转换<br/>- API 映射"]
        Satori["Satori V1<br/>- HTTP/WS 服务端<br/>- Webhook<br/>- 事件转换<br/>- API 映射"]
        Milky["Milky V1<br/>- HTTP/WS 服务端<br/>- HTTP/WS 客户端<br/>- 事件转换<br/>- API 映射"]
    end

    subgraph Account["账号层 (Account)"]
        ACC1["账号实例 1<br/>状态: Online/Offline"]
        ACC2["账号实例 2<br/>状态: Online/Offline"]
        ACC3["账号实例 3<br/>状态: Online/Offline"]
    end

    subgraph Adapter["适配器层 (Adapter)"]
        QQ["QQ Adapter<br/>- API 封装<br/>- 事件转换<br/>- WS 管理"]
        Kook["Kook Adapter<br/>- API 封装<br/>- 事件转换<br/>- WS 管理"]
        DingTalk["DingTalk Adapter<br/>- API 封装<br/>- 事件转换<br/>- WS 管理"]
        WeChat["WeChat Adapter<br/>- API 封装<br/>- 事件转换<br/>- WS 管理"]
    end

    subgraph Platform["平台层"]
        QQ_Platform["QQ 平台"]
        Kook_Platform["Kook 平台"]
        DingTalk_Platform["钉钉平台"]
        WeChat_Platform["企业微信平台"]
    end

    %% 客户端到应用层
    HTTP_Client <-->|"API 调用"| Router
    WS_Client <-->|"事件订阅"| Router
    Webhook <-->|"事件推送"| Router

    %% 应用层内部
    Config --> AdapterMgr
    Router --> Protocol
    Logger -.记录.-> App

    %% 协议层到账号层
    OB11 --> ACC1
    OB12 --> ACC1
    Satori --> ACC2
    Milky --> ACC3

    %% 账号层到适配器层
    ACC1 --> QQ
    ACC2 --> Kook
    ACC3 --> DingTalk

    %% 平台层到适配器层
    QQ_Platform <-->|"WebSocket/API"| QQ
    Kook_Platform <-->|"WebSocket/API"| Kook
    DingTalk_Platform <-->|"WebSocket/API"| DingTalk
    WeChat_Platform <-->|"WebSocket/API"| WeChat

    style Client fill:#e1f5ff
    style App fill:#fff3e0
    style Protocol fill:#f3e5f5
    style Account fill:#e8f5e9
    style Adapter fill:#fce4ec
    style Platform fill:#f5f5f5
```

---

## 2. 接收消息流程图

```mermaid
sequenceDiagram
    participant Platform as 平台服务器<br/>(QQ/Kook/钉钉)
    participant Adapter as 适配器层<br/>(Kook Adapter)
    participant Account as 账号层<br/>(Account Instance)
    participant Protocol as 协议层<br/>(OneBot V11)
    participant Client as 客户端<br/>(Bot 应用)

    Platform->>Adapter: 1. 平台事件<br/>(WebSocket Message)
    Note over Adapter: 2. 接收原始事件<br/>解析 JSON
    
    Adapter->>Adapter: 3. 转换为通用事件<br/>(CommonEvent)
    Note over Adapter: {<br/>  id: "msg_123",<br/>  platform: "kook",<br/>  type: "message",<br/>  message: [...]<br/>}
    
    Adapter->>Account: 4. 分发事件到账号<br/>account.dispatch()
    
    Account->>Protocol: 5. 分发给各协议实例<br/>protocol.dispatch()
    Note over Protocol: 一个账号可启用<br/>多个协议
    
    Protocol->>Protocol: 6. 协议格式转换<br/>(CommonEvent → OneBot Event)
    Note over Protocol: {<br/>  post_type: "message",<br/>  message_type: "group",<br/>  raw_message: "...",<br/>  ...<br/>}
    
    Protocol->>Client: 7. 推送事件
    Note over Protocol,Client: HTTP POST / WebSocket / Webhook
    
    Client-->>Protocol: 8. 响应 ACK
    Protocol-->>Account: 9. 完成
```

---

## 3. 发送消息流程图

```mermaid
sequenceDiagram
    participant Client as 客户端<br/>(Bot 应用)
    participant Protocol as 协议层<br/>(OneBot V11)
    participant Account as 账号层<br/>(Account Instance)
    participant Adapter as 适配器层<br/>(Kook Adapter)
    participant Platform as 平台服务器<br/>(Kook API)

    Client->>Protocol: 1. API 调用<br/>POST /send_message
    Note over Client,Protocol: {<br/>  "action": "send_message",<br/>  "params": {<br/>    "group_id": "123",<br/>    "message": "Hello"<br/>  }<br/>}
    
    Protocol->>Protocol: 2. 参数解析<br/>鉴权验证
    Note over Protocol: - 验证 access_token<br/>- 验证 signature<br/>- 解析 CQ 码
    
    Protocol->>Adapter: 3. 调用适配器方法<br/>adapter.sendMessage()
    Note over Protocol,Adapter: 通过 account.adapter 访问
    
    Adapter->>Adapter: 4. 转换为平台格式
    Note over Adapter: CommonEvent.Segment[]<br/>→<br/>Kook Message Format
    
    Adapter->>Platform: 5. 调用平台 API<br/>POST /api/v3/message/create
    
    Platform-->>Adapter: 6. 返回结果<br/>{msg_id: "xxx"}
    
    Adapter-->>Protocol: 7. 返回消息 ID
    
    Protocol-->>Client: 8. 响应<br/>{<br/>  "status": "ok",<br/>  "data": {<br/>    "message_id": "xxx"<br/>  }<br/>}
```

---

## 4. 配置加载流程图

```mermaid
flowchart TD
    Start([开始启动]) --> LoadConfig[读取 config.yaml]
    
    LoadConfig --> ParseGeneral{解析 general 配置}
    ParseGeneral --> StoreGeneral[存储默认配置]
    
    StoreGeneral --> ParseAccounts{遍历账号配置}
    
    ParseAccounts --> CheckFormat{检查格式<br/>platform.account_id}
    
    CheckFormat -->|"匹配"| SplitKey[分离平台和账号 ID]
    CheckFormat -->|"不匹配"| ParseAccounts
    
    SplitKey --> ExtractConfig[提取配置]
    
    ExtractConfig --> SeparateConfig{区分配置类型}
    
    SeparateConfig -->|"包含点(.)"| ProtocolConfig[协议配置<br/>onebot.v11, satori.v1]
    SeparateConfig -->|"不包含点"| PlatformConfig[平台配置<br/>token, secret]
    
    ProtocolConfig --> MergeConfig[合并配置<br/>general + account]
    PlatformConfig --> MergeConfig
    
    MergeConfig --> FindAdapter{查找或创建<br/>适配器实例}
    
    FindAdapter -->|"已存在"| ReuseAdapter[复用适配器]
    FindAdapter -->|"不存在"| CreateAdapter[创建新适配器]
    
    ReuseAdapter --> CreateAccount[创建账号实例]
    CreateAdapter --> CreateAccount
    
    CreateAccount --> InitProtocols[初始化协议实例]
    
    InitProtocols --> StartServices[启动协议服务]
    
    StartServices --> MoreAccounts{还有账号?}
    
    MoreAccounts -->|"是"| ParseAccounts
    MoreAccounts -->|"否"| StartServer[启动 HTTP/WS 服务器]
    
    StartServer --> End([启动完成])
    
    style Start fill:#4caf50,color:#fff
    style End fill:#4caf50,color:#fff
    style LoadConfig fill:#2196f3,color:#fff
    style MergeConfig fill:#ff9800,color:#fff
    style StartServer fill:#9c27b0,color:#fff
```

---

## 5. 类继承关系图

```mermaid
classDiagram
    class Adapter {
        <<abstract>>
        +platform: string
        +accounts: Map
        +logger: Logger
        +app: App
        +router: Router
        +sendMessage()*
        +deleteMessage()*
        +getMessage()*
        +getUserInfo()*
        +getGroupInfo()*
        +getChannelInfo()*
        +createAccount()
        +startOneBot()
    }
    
    class QQAdapter {
        -bot: QQBot
        -gateway: WebSocket
        +sendMessage()
        +getUserInfo()
        +getGroupInfo()
        ...
    }
    
    class KookAdapter {
        -bots: Map
        -gateway: WebSocket
        +sendMessage()
        +getUserInfo()
        +getChannelInfo()
        ...
    }
    
    class DingTalkAdapter {
        -bot: DingBot
        +sendMessage()
        +getUserInfo()
        ...
    }
    
    class Protocol {
        <<abstract>>
        +version: string
        +account: Account
        +config: Config
        +adapter: Adapter
        +logger: Logger
        +app: App
        +router: Router
        +start()*
        +stop()*
        +dispatch()*
        +format()*
        +apply()*
        +executeAction()*
    }
    
    class OneBotV11 {
        -wsClients: WebSocket[]
        -heartbeatInterval: NodeJS.Timer
        +start()
        +dispatch()
        +executeAction()
        +sendMessage()
        +getGroupInfo()
        ...
    }
    
    class OneBotV12 {
        -wsClients: WebSocket[]
        +start()
        +dispatch()
        +executeAction()
        +sendMessage()
        +getChannelInfo()
        ...
    }
    
    class SatoriV1 {
        -wsClients: WebSocket[]
        +start()
        +dispatch()
        +executeAction()
        +messageCreate()
        +guildGet()
        ...
    }
    
    class MilkyV1 {
        -wsClients: WebSocket[]
        +start()
        +dispatch()
        +executeAction()
        +sendMessage()
        ...
    }
    
    class Account {
        +uin: string
        +platform: string
        +adapter: Adapter
        +protocols: Protocol[]
        +status: AccountStatus
        +dispatch()
        +setOnline()
        +setOffline()
    }
    
    class App {
        +config: Config
        +adapters: Map
        +router: Router
        +logger: Logger
        +init()
        +start()
        +initAccounts()
    }
    
    Adapter <|-- QQAdapter
    Adapter <|-- KookAdapter
    Adapter <|-- DingTalkAdapter
    
    Protocol <|-- OneBotV11
    Protocol <|-- OneBotV12
    Protocol <|-- SatoriV1
    Protocol <|-- MilkyV1
    
    App "1" --> "*" Adapter : 管理
    Adapter "1" --> "*" Account : 创建
    Account "1" --> "*" Protocol : 运行
    Protocol --> Adapter : 调用
```

---

## 6. 事件转换流程图

```mermaid
flowchart LR
    subgraph Platform ["平台原始事件"]
        PE["Kook Event<br/>{<br/>  type: 1,<br/>  content: 'Hello',<br/>  author_id: '123',<br/>  target_id: 'xxx'<br/>}"]
    end
    
    subgraph Adapter ["适配器转换"]
        AT["toCommonEvent()<br/>↓<br/>CommonEvent"]
    end
    
    subgraph Common ["通用事件格式"]
        CE["CommonEvent<br/>{<br/>  id: 'msg_123',<br/>  platform: 'kook',<br/>  type: 'message',<br/>  message_type: 'group',<br/>  group_id: 'xxx',<br/>  user_id: '123',<br/>  message: [<br/>    {type: 'text', data: {text: 'Hello'}}<br/>  ],<br/>  sender: {id: '123', name: 'User'}<br/>}"]
    end
    
    subgraph Protocols ["协议格式转换"]
        P1["OneBot V11<br/>format()<br/>↓<br/>{<br/>  post_type: 'message',<br/>  message_type: 'group',<br/>  group_id: 'xxx',<br/>  user_id: '123',<br/>  message: 'Hello',<br/>  raw_message: 'Hello'<br/>}"]
        
        P2["OneBot V12<br/>format()<br/>↓<br/>{<br/>  type: 'message',<br/>  detail_type: 'group',<br/>  group_id: 'xxx',<br/>  user_id: '123',<br/>  message: [<br/>    {type: 'text', data: {text: 'Hello'}}<br/>  ]<br/>}"]
        
        P3["Satori V1<br/>format()<br/>↓<br/>{<br/>  type: 'message-created',<br/>  channel: {id: 'xxx'},<br/>  user: {id: '123'},<br/>  message: {<br/>    content: 'Hello'<br/>  }<br/>}"]
        
        P4["Milky V1<br/>format()<br/>↓<br/>{<br/>  type: 'message',<br/>  scene_type: 'group',<br/>  scene_id: 'xxx',<br/>  sender: {<br/>    id: '123',<br/>    name: 'User'<br/>  },<br/>  message: [...]<br/>}"]
    end
    
    subgraph Client ["客户端接收"]
        C1["Bot App 1<br/>(OneBot V11)"]
        C2["Bot App 2<br/>(OneBot V12)"]
        C3["Bot App 3<br/>(Satori)"]
        C4["Bot App 4<br/>(Milky)"]
    end
    
    PE --> AT --> CE
    CE --> P1 --> C1
    CE --> P2 --> C2
    CE --> P3 --> C3
    CE --> P4 --> C4
    
    style Platform fill:#ffebee
    style Adapter fill:#fff3e0
    style Common fill:#e8f5e9
    style Protocols fill:#e1f5ff
    style Client fill:#f3e5f5
```

---

## 7. 协议通信方式对比图

```mermaid
graph TB
    subgraph OB["OneBot V11/V12"]
        direction TB
        OB_Server["服务端模式"]
        OB_HTTP["HTTP Server<br/>POST /api/action"]
        OB_WS["WebSocket Server<br/>WS /ws"]
        
        OB_Client["客户端模式"]
        OB_HTTP_Rev["HTTP Reverse<br/>POST to URL"]
        OB_WS_Rev["WebSocket Reverse<br/>Connect to URL"]
        
        OB_Auth["鉴权方式<br/>• access_token<br/>• secret (HMAC-SHA1)"]
        
        OB_Server --> OB_HTTP
        OB_Server --> OB_WS
        OB_Client --> OB_HTTP_Rev
        OB_Client --> OB_WS_Rev
    end
    
    subgraph SAT["Satori V1"]
        direction TB
        SAT_Server["服务端模式"]
        SAT_HTTP["HTTP Server<br/>POST /v1/method"]
        SAT_WS["WebSocket Server<br/>WS /v1/events"]
        
        SAT_Client["客户端模式"]
        SAT_Webhook["Webhook<br/>POST to URL"]
        
        SAT_Auth["鉴权方式<br/>• token (Bearer)"]
        
        SAT_Server --> SAT_HTTP
        SAT_Server --> SAT_WS
        SAT_Client --> SAT_Webhook
    end
    
    subgraph MLK["Milky V1"]
        direction TB
        MLK_Server["服务端模式"]
        MLK_HTTP["HTTP Server<br/>POST /path/:action"]
        MLK_WS["WebSocket Server<br/>WS /path"]
        
        MLK_Client["客户端模式"]
        MLK_HTTP_Rev["HTTP Reverse<br/>POST to URL"]
        MLK_WS_Rev["WebSocket Reverse<br/>Connect to URL"]
        
        MLK_Auth["鉴权方式<br/>• access_token<br/>• secret (HMAC-SHA1)"]
        
        MLK_Server --> MLK_HTTP
        MLK_Server --> MLK_WS
        MLK_Client --> MLK_HTTP_Rev
        MLK_Client --> MLK_WS_Rev
    end
    
    style OB fill:#e3f2fd
    style SAT fill:#f3e5f5
    style MLK fill:#fff3e0
    style OB_Auth fill:#ffcdd2
    style SAT_Auth fill:#ffcdd2
    style MLK_Auth fill:#ffcdd2
```

---

## 8. 目录结构图

```mermaid
graph TD
    Root["onebots/"]
    
    Root --> Src["src/"]
    Root --> Config["config.yaml"]
    Root --> Package["package.json"]
    
    Src --> CoreFiles["核心文件"]
    Src --> Adapters["adapters/"]
    Src --> Protocols["protocols/"]
    Src --> Server["server/"]
    
    CoreFiles --> Account["account.ts<br/>账号管理"]
    CoreFiles --> Adapter["adapter.ts<br/>适配器基类"]
    CoreFiles --> Protocol["protocol.ts<br/>协议基类"]
    CoreFiles --> Types["common-types.ts<br/>类型定义"]
    CoreFiles --> Logger["logger.ts<br/>日志系统"]
    CoreFiles --> Router["router.ts<br/>路由管理"]
    
    Adapters --> QQ["qq/<br/>QQ 适配器"]
    Adapters --> Kook["kook/<br/>Kook 适配器"]
    Adapters --> DingTalk["dingtalk/<br/>钉钉适配器"]
    Adapters --> WeChat["wechat/<br/>企微适配器"]
    
    Kook --> KookIndex["index.ts"]
    Kook --> KookUtils["utils.ts"]
    Kook --> KookReadme["README.md"]
    
    Protocols --> OneBot["onebot/"]
    Protocols --> Satori["satori/"]
    Protocols --> Milky["milky/"]
    
    OneBot --> V11["v11.ts"]
    OneBot --> V12["v12.ts"]
    OneBot --> OBTypes["types.ts"]
    OneBot --> CQCode["cqcode.ts"]
    
    Satori --> SatV1["v1.ts"]
    Satori --> SatTypes["types.ts"]
    
    Milky --> MlkV1["v1.ts"]
    Milky --> MlkTypes["types.ts"]
    
    Server --> App["app.ts<br/>主应用"]
    Server --> Index["index.ts<br/>入口文件"]
    
    style Root fill:#4caf50,color:#fff
    style Src fill:#2196f3,color:#fff
    style CoreFiles fill:#ff9800,color:#fff
    style Adapters fill:#e91e63,color:#fff
    style Protocols fill:#9c27b0,color:#fff
    style Server fill:#00bcd4,color:#fff
```

---

## 9. 部署架构图

```mermaid
graph TB
    subgraph External["外部服务"]
        QQ_API["QQ 官方 API"]
        Kook_API["Kook API"]
        DingTalk_API["钉钉 API"]
    end
    
    subgraph onebots["onebots 服务器"]
        App["onebots App<br/>Port: 6727"]
        
        subgraph Adapters["适配器实例"]
            QQ_Adapter["QQ Adapter"]
            Kook_Adapter["Kook Adapter"]
            DT_Adapter["DingTalk Adapter"]
        end
        
        subgraph Accounts["账号实例"]
            ACC1["qq.bot1"]
            ACC2["kook.bot1"]
            ACC3["dingtalk.bot1"]
        end
        
        subgraph Protocols["协议服务"]
            OB11_1["OneBot V11<br/>/onebot/v11"]
            OB12_1["OneBot V12<br/>/onebot/v12"]
            SAT_1["Satori V1<br/>/satori"]
            MLK_1["Milky V1<br/>/milky"]
        end
    end
    
    subgraph BotApps["Bot 应用"]
        Bot1["Bot App 1<br/>(OneBot V11 客户端)"]
        Bot2["Bot App 2<br/>(OneBot V12 客户端)"]
        Bot3["Bot App 3<br/>(Satori 客户端)"]
        Bot4["Bot App 4<br/>(Milky 客户端)"]
    end
    
    %% 外部连接
    QQ_API <-->|WebSocket| QQ_Adapter
    Kook_API <-->|WebSocket| Kook_Adapter
    DingTalk_API <-->|WebSocket| DT_Adapter
    
    %% 内部连接
    QQ_Adapter --> ACC1
    Kook_Adapter --> ACC2
    DT_Adapter --> ACC3
    
    ACC1 --> OB11_1
    ACC2 --> OB12_1
    ACC2 --> SAT_1
    ACC3 --> MLK_1
    
    %% Bot 应用连接
    OB11_1 <-->|HTTP/WebSocket| Bot1
    OB12_1 <-->|HTTP/WebSocket| Bot2
    SAT_1 <-->|HTTP/WebSocket| Bot3
    MLK_1 <-->|HTTP/WebSocket| Bot4
    
    style External fill:#ffebee
    style onebots fill:#e8f5e9
    style BotApps fill:#e1f5ff
    style App fill:#4caf50,color:#fff
```

---

## 使用说明

1. **在线预览和导出**：复制任意图表的 Mermaid 代码到 https://mermaid.live/
2. **批量导出**：使用 Mermaid CLI 工具批量生成图片
3. **集成到文档**：Markdown 工具（如 Typora、VS Code）可直接渲染 Mermaid 图表
4. **自定义样式**：可以修改 `style` 语句调整颜色和样式

