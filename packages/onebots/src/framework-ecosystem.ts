type FrameworkProtocol = "onebot.v11" | "onebot.v12" | "satori.v1" | "milky.v1";
type FrameworkTransport = "websocket" | "reverse-websocket" | "sse" | "webhook";
type FrameworkKind = "framework" | "distribution";

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
    runtime: {
        stage: "experimental" | "legacy";
        protocol: FrameworkProtocol;
        transport: FrameworkTransport;
        defaultFrameworkOrigin: string | null;
        reversePath?: string;
    };
}

const ENTRIES: readonly FrameworkEcosystemEntry[] = deepFreeze([
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
        limitation: "上游仍将 Satori 标为 WIP；仅提供可撤销的实验连接模板，不承诺生产稳定性。",
        runtime: {
            stage: "experimental",
            protocol: "satori.v1",
            transport: "websocket",
            defaultFrameworkOrigin: null,
        },
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
        runtime: {
            stage: "experimental",
            protocol: "onebot.v11",
            transport: "websocket",
            defaultFrameworkOrigin: null,
        },
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
        runtime: {
            stage: "experimental",
            protocol: "onebot.v11",
            transport: "websocket",
            defaultFrameworkOrigin: null,
        },
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
        runtime: {
            stage: "experimental",
            protocol: "onebot.v11",
            transport: "websocket",
            defaultFrameworkOrigin: null,
        },
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
        runtime: {
            stage: "experimental",
            protocol: "onebot.v11",
            transport: "websocket",
            defaultFrameworkOrigin: null,
        },
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
        runtime: {
            stage: "experimental",
            protocol: "onebot.v11",
            transport: "websocket",
            defaultFrameworkOrigin: null,
        },
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
        runtime: {
            stage: "experimental",
            protocol: "onebot.v12",
            transport: "websocket",
            defaultFrameworkOrigin: null,
        },
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
        runtime: {
            stage: "experimental",
            protocol: "onebot.v11",
            transport: "websocket",
            defaultFrameworkOrigin: null,
        },
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
        runtime: {
            stage: "experimental",
            protocol: "onebot.v11",
            transport: "reverse-websocket",
            defaultFrameworkOrigin: "http://127.0.0.1:8080",
            reversePath: "/onebot/v11/ws",
        },
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
        runtime: {
            stage: "legacy",
            protocol: "onebot.v11",
            transport: "websocket",
            defaultFrameworkOrigin: null,
        },
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
        runtime: {
            stage: "legacy",
            protocol: "onebot.v11",
            transport: "reverse-websocket",
            defaultFrameworkOrigin: "http://127.0.0.1:8080",
            reversePath: "/ws",
        },
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
