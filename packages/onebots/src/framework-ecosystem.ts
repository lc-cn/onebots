import type {
    FrameworkKind,
    FrameworkProtocol,
    FrameworkTransport,
} from "./framework-integration.js";

export type EcosystemEntryKind = FrameworkKind | "sdk" | "bridge";
export type EcosystemPriority = "next" | "later" | "legacy";

export interface FrameworkEcosystemEntry {
    id: string;
    displayName: string;
    kind: EcosystemEntryKind;
    language: string;
    protocols: readonly FrameworkProtocol[];
    transports: readonly FrameworkTransport[];
    priority: EcosystemPriority;
    upstream: string;
    evidence: string;
    limitation: string;
}

const ENTRIES: readonly FrameworkEcosystemEntry[] = deepFreeze([
    {
        id: "astrbot",
        displayName: "AstrBot",
        kind: "framework",
        language: "Python",
        protocols: ["onebot.v11"],
        transports: ["reverse-websocket"],
        priority: "next",
        upstream: "https://github.com/AstrBotDevs/AstrBot",
        evidence:
            "源码 6ee1ddd4fda2 与官方文档提供 OneBot v11 反向 WebSocket 服务端，默认路径 /ws。",
        limitation: "完整 AstrBot 运行时依赖模型服务和持久化初始化，尚未形成可复现最小进程门禁。",
    },
    {
        id: "langbot",
        displayName: "LangBot",
        kind: "framework",
        language: "Python",
        protocols: ["onebot.v11"],
        transports: ["reverse-websocket"],
        priority: "next",
        upstream: "https://github.com/langbot-app/LangBot",
        evidence: "源码 601c6975ea19 与官方 Wiki 提供 OneBot v11 适配器及协议端连接流程。",
        limitation: "当前连接由 WebUI 持久化配置驱动，尚无稳定的无交互最小夹具接口。",
    },
    {
        id: "alicebot",
        displayName: "AliceBot",
        kind: "framework",
        language: "Python",
        protocols: ["onebot.v11"],
        transports: ["websocket", "reverse-websocket"],
        priority: "next",
        upstream: "https://github.com/AliceBotProject/alicebot",
        evidence: "源码 1ff633db3937 固定 alicebot 与 CQHTTP adapter 0.11.0。",
        limitation:
            "0.11.0 正向模式固定连接根路径；反向 token 校验读取响应头，安全互操作门禁未通过。",
    },
    {
        id: "kovi",
        displayName: "Kovi",
        kind: "framework",
        language: "Rust",
        protocols: ["milky.v1", "onebot.v11"],
        transports: ["websocket"],
        priority: "next",
        upstream: "https://github.com/ThriceCola/Kovi",
        evidence: "源码 6b4532fbea9b 固定 Kovi 0.13.0、OneBot driver 0.13.2。",
        limitation:
            "OneBot driver 分离 /api 与 /event；all_in_one 又忽略配置 path，尚不能表达 OneBots 账号端点。",
    },
    {
        id: "kotori",
        displayName: "Kotori",
        kind: "framework",
        language: "TypeScript",
        protocols: ["onebot.v11"],
        transports: ["websocket"],
        priority: "next",
        upstream: "https://github.com/kotorijs/kotori",
        evidence: "源码 793da0ea5ebe 固定 Kotori 1.7.5 与 OneBot adapter 2.1.2。",
        limitation:
            "正向模式将 address 与 port 简单拼接，无法保留 OneBots 路径；反向模式仍需鉴权审计。",
    },
    {
        id: "avilla",
        displayName: "Avilla",
        kind: "framework",
        language: "Python",
        protocols: ["onebot.v11", "satori.v1", "onebot.v12"],
        transports: ["websocket"],
        priority: "later",
        upstream: "https://github.com/GraiaProject/Avilla",
        evidence: "官方路线图包含 OneBot 11、Satori v1 与 OneBot 12。",
        limitation: "上游将相关组件标为 WIP 或 Planned，暂不生成生产配置。",
    },
    {
        id: "olivos",
        displayName: "OlivOS",
        kind: "framework",
        language: "Python",
        protocols: ["onebot.v11", "onebot.v12"],
        transports: ["websocket", "reverse-websocket"],
        priority: "later",
        upstream: "https://github.com/OlivOS-Team/OlivOS",
        evidence: "OneBot 官方生态同时把 OlivOS 收录为 v11 与 v12 SDK。",
        limitation: "多进程交互栈配置面较大，需先缩小到 OneBots 单一连接方案。",
    },
    {
        id: "zhamao",
        displayName: "炸毛框架",
        kind: "framework",
        language: "PHP",
        protocols: ["onebot.v11", "onebot.v12"],
        transports: ["websocket", "reverse-websocket"],
        priority: "later",
        upstream: "https://github.com/zhamao-robot/zhamao-framework",
        evidence: "OneBot 官方生态同时收录其 v11 与 v12 SDK。",
        limitation: "需要核对当前 PHP 运行时、驱动和连接配置。",
    },
    {
        id: "shiro",
        displayName: "Shiro",
        kind: "framework",
        language: "Java",
        protocols: ["onebot.v11"],
        transports: ["websocket"],
        priority: "later",
        upstream: "https://github.com/MisakaTAT/Shiro",
        evidence: "OneBot 官方生态收录的 Java OneBot 开发框架。",
        limitation: "需要核对 Spring Boot starter 版本与会话配置。",
    },
    {
        id: "simbot-onebot",
        displayName: "Simple Robot OneBot",
        kind: "sdk",
        language: "Kotlin",
        protocols: ["onebot.v11"],
        transports: ["websocket"],
        priority: "later",
        upstream: "https://github.com/simple-robot/simbot-component-onebot",
        evidence: "OneBot 官方生态收录的 Kotlin Multiplatform / Java 友好组件。",
        limitation: "它是组件 SDK，验收应嵌入最小 Simbot 应用而非独立进程。",
    },
    {
        id: "overflow",
        displayName: "Overflow",
        kind: "bridge",
        language: "Kotlin",
        protocols: ["onebot.v11"],
        transports: ["websocket"],
        priority: "later",
        upstream: "https://github.com/MrXiaoM/Overflow",
        evidence: "OneBot 官方生态收录的 Mirai 到 OneBot 无缝迁移桥。",
        limitation: "需要单独验证 Mirai 事件模型和 OneBot 字段之间的兼容假设。",
    },
    {
        id: "walle",
        displayName: "Walle",
        kind: "sdk",
        language: "Rust",
        protocols: ["onebot.v12"],
        transports: ["websocket", "reverse-websocket"],
        priority: "later",
        upstream: "https://github.com/onebot-walle/walle",
        evidence: "OneBot 官方生态收录的 Rust OneBot 12 SDK。",
        limitation: "需要先扩大 OneBots 的 OneBot 12 动作和事件门禁。",
    },
    {
        id: "adachi-bot",
        displayName: "Adachi-BOT",
        kind: "distribution",
        language: "TypeScript",
        protocols: ["onebot.v11"],
        transports: ["websocket"],
        priority: "later",
        upstream: "https://github.com/SilveryStar/Adachi-BOT",
        evidence: "OneBot 官方生态列出的可扩展机器人发行版，声明兼容 OneBot 11。",
        limitation: "需要像云崽一样审计实际插件使用的私有动作。",
    },
    {
        id: "genshinuid",
        displayName: "GenshinUID",
        kind: "distribution",
        language: "Python",
        protocols: ["onebot.v11", "onebot.v12"],
        transports: ["websocket", "reverse-websocket"],
        priority: "later",
        upstream: "https://github.com/KimigaiiWuyi/GenshinUID",
        evidence: "官方仓库声明支持 OneBot、OneBot v12 及多种宿主框架。",
        limitation: "它同时支持多宿主，需分别选择 gsuid-core 连接层和宿主门禁。",
    },
    {
        id: "pepperbot",
        displayName: "PepperBot",
        kind: "framework",
        language: "Python",
        protocols: ["onebot.v11"],
        transports: ["websocket", "reverse-websocket"],
        priority: "legacy",
        upstream: "https://github.com/SSmJaE/PepperBot",
        evidence: "OneBot 官方生态收录的 Python OneBot 11 SDK。",
        limitation: "先确认维护状态与现代 Python 版本兼容性，再决定是否投入门禁。",
    },
    {
        id: "nonebot1",
        displayName: "NoneBot 1",
        kind: "framework",
        language: "Python",
        protocols: ["onebot.v11"],
        transports: ["websocket", "reverse-websocket"],
        priority: "legacy",
        upstream: "https://github.com/nonebot/nonebot",
        evidence: "OneBot 官方生态仍将其列为 OneBot 11 SDK。",
        limitation: "仅作为存量迁移目标；新部署继续推荐 NoneBot2。",
    },
]);

export function listFrameworkEcosystem(): readonly FrameworkEcosystemEntry[] {
    return ENTRIES;
}

function deepFreeze<T>(value: T): T {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) deepFreeze(nested);
    return Object.freeze(value);
}
