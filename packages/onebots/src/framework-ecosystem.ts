import type {
    FrameworkKind,
    FrameworkProtocol,
    FrameworkTransport,
} from "./framework-integration.js";
import { ApplicationRegistry, defineApplication } from "@onebots/core";

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

for (const entry of ENTRIES) {
    ApplicationRegistry.register(
        defineApplication({
            name: entry.id,
            displayName: entry.displayName,
            description: entry.evidence,
            homepage: entry.upstream,
            stage: "planned",
            createProtocolExtension: () => undefined,
            unsupportedProtocol: () => [entry.limitation],
        }),
    );
}

function deepFreeze<T>(value: T): T {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) deepFreeze(nested);
    return Object.freeze(value);
}
