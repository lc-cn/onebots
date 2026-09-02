import yaml from "js-yaml";

export type FrameworkId =
    | "koishi"
    | "nonebot"
    | "karin"
    | "zhin"
    | "alemonjs"
    | "yunzai"
    | "zhenxun";

export type FrameworkKind = "framework" | "distribution";
export type FrameworkProtocol = "onebot.v11" | "onebot.v12" | "satori.v1" | "milky.v1";
export type FrameworkTransport = "websocket" | "reverse-websocket" | "sse" | "webhook";
export type FrameworkVerificationLevel =
    | "documented"
    | "handshake"
    | "messages"
    | "actions"
    | "verified";

export interface FrameworkProfile {
    id: FrameworkId;
    displayName: string;
    kind: FrameworkKind;
    packageName: string | null;
    protocol: FrameworkProtocol;
    transport: FrameworkTransport;
    verification: FrameworkVerificationLevel;
    evidence?: FrameworkVerificationEvidence;
    upstream: string;
    defaultFrameworkOrigin: string | null;
    limitations: readonly string[];
}

export interface FrameworkVerificationEvidence {
    frameworkVersion: string;
    adapterVersion: string;
    lastVerifiedAt: string;
    command: string;
    checks: readonly string[];
}

export interface FrameworkConnectionRequest {
    framework: FrameworkId;
    account: string;
    onebotsOrigin?: string;
    frameworkOrigin?: string;
}

export interface FrameworkConnectionCheck {
    name: string;
    command?: string;
    expected: string;
}

export interface FrameworkConnectionPlan {
    schemaVersion: 1;
    framework: FrameworkProfile;
    account: { platform: string; accountId: string; key: string };
    protocol: FrameworkProtocol;
    transport: FrameworkTransport;
    endpoint: string;
    onebotsConfig: string;
    frameworkConfig: string;
    checks: FrameworkConnectionCheck[];
    limitations: string[];
}

const SHARED_TOKEN = "<shared-token>";

const PROFILES: Readonly<Record<FrameworkId, FrameworkProfile>> = deepFreeze({
    koishi: {
        id: "koishi",
        displayName: "Koishi",
        kind: "framework",
        packageName: "@koishijs/plugin-adapter-satori",
        protocol: "satori.v1",
        transport: "websocket",
        verification: "documented",
        upstream: "https://koishi.chat/en-US/plugins/adapter/satori",
        defaultFrameworkOrigin: null,
        limitations: [
            "当前 Koishi 使用 Satori v3；OneBots satori.v1 尚未完成固定版本互操作验证。",
            "此模板仅用于差异审计，不应作为生产兼容声明。",
        ],
    },
    nonebot: {
        id: "nonebot",
        displayName: "NoneBot2",
        kind: "framework",
        packageName: "nonebot-adapter-onebot",
        protocol: "onebot.v11",
        transport: "reverse-websocket",
        verification: "handshake",
        evidence: {
            frameworkVersion: "2.5.0",
            adapterVersion: "2.4.6",
            lastVerifiedAt: "2026-09-02",
            command: "pnpm interop:nonebot",
            checks: [
                "auth-rejection",
                "handshake",
                "private-message",
                "get_login_info",
                "send_private_msg",
            ],
        },
        upstream: "https://onebot.adapters.nonebot.dev/docs/guide/setup/",
        defaultFrameworkOrigin: "http://127.0.0.1:8080",
        limitations: ["群消息、富媒体、重连与完整动作矩阵仍待固定版本验证。"],
    },
    karin: {
        id: "karin",
        displayName: "Karin",
        kind: "framework",
        packageName: "@karinjs/plugin-adapter-milky",
        protocol: "milky.v1",
        transport: "websocket",
        verification: "handshake",
        evidence: {
            frameworkVersion: "1.15.3",
            adapterVersion: "1.3.3",
            lastVerifiedAt: "2026-09-02",
            command: "pnpm interop:karin",
            checks: [
                "auth-rejection",
                "handshake",
                "private-message",
                "get_login_info",
                "get_impl_info",
                "send_private_message",
            ],
        },
        upstream: "https://github.com/KarinJS/karin-plugin-adapter-milky",
        defaultFrameworkOrigin: null,
        limitations: [
            "群消息、富媒体、重连、SSE、Webhook 与完整动作矩阵仍待固定版本验证。",
            "插件 1.3.3 未在发布包依赖中声明 node-karin，独立安装时必须显式安装 1.15.3。",
            "node-karin 1.15.3 固定 yaml 2.7.0，受 GHSA-48c2-rrv3-qjmp 影响且当前无可用自动修复。",
        ],
    },
    zhin: {
        id: "zhin",
        displayName: "Zhin",
        kind: "framework",
        packageName: "@zhin.js/adapter-onebot11",
        protocol: "onebot.v11",
        transport: "websocket",
        verification: "handshake",
        evidence: {
            frameworkVersion: "6.0.15",
            adapterVersion: "7.0.8",
            lastVerifiedAt: "2026-09-02",
            command: "pnpm interop:zhin",
            checks: [
                "auth-rejection",
                "handshake",
                "private-message",
                "get_login_info",
                "send_private_msg",
            ],
        },
        upstream: "https://www.npmjs.com/package/@zhin.js/adapter-onebot11",
        defaultFrameworkOrigin: null,
        limitations: ["群消息、富媒体、重连、侧事件与完整动作矩阵仍待固定版本验证。"],
    },
    alemonjs: {
        id: "alemonjs",
        displayName: "AlemonJS",
        kind: "framework",
        packageName: "@alemonjs/onebot",
        protocol: "onebot.v11",
        transport: "websocket",
        verification: "handshake",
        evidence: {
            frameworkVersion: "2.1.103",
            adapterVersion: "2.1.21",
            lastVerifiedAt: "2026-09-02",
            command: "pnpm interop:alemonjs",
            checks: [
                "auth-rejection",
                "handshake",
                "private-message",
                "get_login_info",
                "send_private_msg",
            ],
        },
        upstream: "https://www.npmjs.com/package/@alemonjs/onebot",
        defaultFrameworkOrigin: null,
        limitations: [
            "OneBot 12 仍是上游实验路径；默认模板固定使用 OneBot 11。",
            "固定版本依赖的 npm audit 报告 file-type 中等级拒绝服务风险；上游修复前不提升为 verified。",
            "群消息、富媒体、重连、侧事件与完整动作矩阵仍待固定版本验证。",
        ],
    },
    yunzai: {
        id: "yunzai",
        displayName: "云崽 / TRSS-Yunzai",
        kind: "distribution",
        packageName: null,
        protocol: "onebot.v11",
        transport: "reverse-websocket",
        verification: "documented",
        upstream: "https://yunzai-bot.com/get-started/platform.html",
        defaultFrameworkOrigin: "http://127.0.0.1:2536",
        limitations: [
            "不同云崽分支的 OneBot 入口与扩展动作并不完全一致。",
            "模板不承诺 NapCat、go-cqhttp 或 ICQQ 私有动作。",
        ],
    },
    zhenxun: {
        id: "zhenxun",
        displayName: "真寻",
        kind: "distribution",
        packageName: "nonebot-adapter-onebot",
        protocol: "onebot.v11",
        transport: "reverse-websocket",
        verification: "documented",
        upstream: "https://github.com/zhenxun-org/zhenxun_bot",
        defaultFrameworkOrigin: "http://127.0.0.1:8080",
        limitations: [
            "基础连接跟随 NoneBot2，仍需单独验证真寻插件使用的扩展动作。",
            "模板不承诺 QQ 协议端私有字段。",
        ],
    },
});

export function listFrameworkProfiles(): readonly FrameworkProfile[] {
    return Object.values(PROFILES);
}

export function getFrameworkProfile(id: string): FrameworkProfile | undefined {
    return PROFILES[id as FrameworkId];
}

export function createFrameworkConnectionPlan(
    request: FrameworkConnectionRequest,
): FrameworkConnectionPlan {
    const profile = getFrameworkProfile(request.framework);
    if (!profile) throw new TypeError(`未知机器人框架：${request.framework}`);
    const account = parseAccountKey(request.account);
    const onebotsOrigin = normalizeHttpOrigin(
        request.onebotsOrigin ?? "http://127.0.0.1:6727",
        "OneBots origin",
    );
    const frameworkOrigin = resolveFrameworkOrigin(profile, request.frameworkOrigin);
    const protocolPath =
        `${onebotsOrigin.pathname}/${account.platform}/${account.accountId}/${profile.protocol.replace(".", "/")}`.replace(
            /\/{2,}/gu,
            "/",
        );
    const onebotsEndpoint = new URL(protocolPath, onebotsOrigin).toString().replace(/\/$/u, "");
    const endpoint = resolveEndpoint(profile, onebotsEndpoint, frameworkOrigin);
    const onebotsConfig = renderOnebotsConfig(profile, account.key, endpoint);
    const frameworkConfig = renderFrameworkConfig(profile, onebotsEndpoint, endpoint);

    return {
        schemaVersion: 1,
        framework: profile,
        account,
        protocol: profile.protocol,
        transport: profile.transport,
        endpoint,
        onebotsConfig,
        frameworkConfig,
        checks: createChecks(profile, onebotsEndpoint),
        limitations: [...profile.limitations],
    };
}

function parseAccountKey(key: string): FrameworkConnectionPlan["account"] {
    const separator = key.indexOf(".");
    const platform = separator > 0 ? key.slice(0, separator) : "";
    const accountId = separator > 0 ? key.slice(separator + 1) : "";
    if (!isSafeRoutePart(platform) || !isSafeRoutePart(accountId)) {
        throw new TypeError("账号必须使用 platform.account_id，且不能包含斜杠、空白、%、? 或 #");
    }
    return { platform, accountId, key };
}

function isSafeRoutePart(value: string): boolean {
    return value.length > 0 && !/[\s/%?#\\]/u.test(value);
}

function normalizeHttpOrigin(value: string, label: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new TypeError(`${label} 不是有效 URL`);
    }
    if (!["http:", "https:"].includes(url.protocol)) {
        throw new TypeError(`${label} 只允许 http 或 https`);
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new TypeError(`${label} 不能包含凭据、查询参数或 fragment`);
    }
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url;
}

function resolveFrameworkOrigin(profile: FrameworkProfile, value?: string): URL | null {
    if (profile.transport !== "reverse-websocket") return null;
    const origin = value ?? profile.defaultFrameworkOrigin;
    if (!origin) throw new TypeError(`${profile.displayName} 反向 WebSocket 缺少 framework origin`);
    return normalizeHttpOrigin(origin, `${profile.displayName} framework origin`);
}

function resolveEndpoint(
    profile: FrameworkProfile,
    onebotsEndpoint: string,
    frameworkOrigin: URL | null,
): string {
    if (profile.transport !== "reverse-websocket") {
        return profile.transport === "websocket" && profile.protocol.startsWith("onebot")
            ? toWebSocketUrl(onebotsEndpoint)
            : onebotsEndpoint;
    }
    const path = profile.id === "yunzai" ? "/OneBotv11" : "/onebot/v11/ws";
    const basePath = frameworkOrigin!.pathname.replace(/\/+$/u, "");
    return toWebSocketUrl(new URL(`${basePath}${path}`, frameworkOrigin!).toString());
}

function renderOnebotsConfig(
    profile: FrameworkProfile,
    accountKey: string,
    endpoint: string,
): string {
    const protocolConfig: Record<string, unknown> = { access_token: SHARED_TOKEN };
    if (profile.transport === "reverse-websocket") {
        protocolConfig.use_http = false;
        protocolConfig.use_ws = false;
        protocolConfig.ws_reverse = [endpoint];
    } else {
        protocolConfig.use_http = true;
        protocolConfig.use_ws = true;
    }
    return yaml.dump({ [accountKey]: { [profile.protocol]: protocolConfig } }, { noRefs: true });
}

function renderFrameworkConfig(
    profile: FrameworkProfile,
    onebotsEndpoint: string,
    endpoint: string,
): string {
    switch (profile.id) {
        case "nonebot":
        case "zhenxun":
            return [
                "# .env",
                "DRIVER=~fastapi+~websockets",
                `ONEBOT_V11_ACCESS_TOKEN=${SHARED_TOKEN}`,
                `# OneBots 主动连接 ${endpoint}`,
            ].join("\n");
        case "zhin":
            return yaml.dump({
                plugins: {
                    onebot11: {
                        connection: "ws",
                        name: "onebots",
                        url: endpoint,
                        access_token: SHARED_TOKEN,
                    },
                },
            });
        case "alemonjs":
            return yaml.dump({
                onebot: { url: endpoint, token: SHARED_TOKEN, reverse_enable: false },
            });
        case "karin":
            return JSON.stringify(
                {
                    reconnectMaxCount: -1,
                    reconnectInterval: 5,
                    bots: [{ protocol: "websocket", url: onebotsEndpoint, token: SHARED_TOKEN }],
                },
                null,
                2,
            );
        case "yunzai":
            return [
                "# TRSS-Yunzai 默认监听地址",
                `OneBotv11: ${endpoint}`,
                `access_token: ${SHARED_TOKEN}`,
            ].join("\n");
        case "koishi":
            return yaml.dump({
                plugins: {
                    "adapter-satori": { endpoint: onebotsEndpoint, token: SHARED_TOKEN },
                },
            });
    }
}

function createChecks(
    profile: FrameworkProfile,
    onebotsEndpoint: string,
): FrameworkConnectionCheck[] {
    const checks: FrameworkConnectionCheck[] = [
        {
            name: "OneBots 就绪",
            command: "onebots status",
            expected: "目标账号和协议出口处于 ready",
        },
        {
            name: "协议身份",
            expected: `${profile.displayName} 识别 OneBots 账号且错误 token 无法连接`,
        },
        {
            name: "消息闭环",
            expected: "私聊与群聊事件可接收、回复并保留消息 ID",
        },
    ];
    if (profile.transport !== "reverse-websocket") {
        checks.splice(1, 0, {
            name: "协议端点",
            expected: `${onebotsEndpoint} 可由框架所在网络访问`,
        });
    }
    return checks;
}

function toWebSocketUrl(value: string): string {
    const url = new URL(value);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString().replace(/\/$/u, "");
}

function deepFreeze<T>(value: T): T {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) deepFreeze(nested);
    return Object.freeze(value);
}
