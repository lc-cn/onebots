import yaml from "js-yaml";

export type FrameworkId =
    | "koishi"
    | "nonebot"
    | "karin"
    | "zhin"
    | "alemonjs"
    | "melobot"
    | "zerobot"
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
    distributionAudit?: DistributionCompatibilityAudit;
    upstream: string;
    defaultFrameworkOrigin: string | null;
    limitations: readonly string[];
}

export interface DistributionCompatibilityAudit {
    sourceRevision: string;
    auditedAt: string;
    requiredActions: readonly string[];
    supportedActions: readonly string[];
    unsupportedActions: readonly string[];
    note: string;
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
        verification: "handshake",
        evidence: {
            frameworkVersion: "4.18.6",
            adapterVersion: "1.5.1",
            lastVerifiedAt: "2026-09-02",
            command: "pnpm interop:koishi",
            checks: ["auth-rejection", "handshake", "private-message", "message.create"],
        },
        upstream: "https://koishi.chat/en-US/plugins/adapter/satori",
        defaultFrameworkOrigin: null,
        limitations: [
            "群消息、富媒体、重连与完整 Satori 资源动作矩阵仍待固定版本验证。",
            "Koishi 4.18.6 的固定依赖审计包含由 file-type GHSA-5v7r-6r5c-r473 传播的 12 个中等级条目。",
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
    melobot: {
        id: "melobot",
        displayName: "melobot",
        kind: "framework",
        packageName: "melobot[onebot]",
        protocol: "onebot.v11",
        transport: "websocket",
        verification: "handshake",
        evidence: {
            frameworkVersion: "3.4.0",
            adapterVersion: "built-in",
            lastVerifiedAt: "2026-09-02",
            command: "pnpm interop:melobot",
            checks: [
                "auth-rejection",
                "handshake",
                "private-message",
                "get_login_info",
                "send_private_msg",
            ],
        },
        upstream: "https://docs.melobot.org/ob_refer/impl.html",
        defaultFrameworkOrigin: null,
        limitations: ["群消息、富媒体、重连、反向 WebSocket 与完整动作矩阵仍待验证。"],
    },
    zerobot: {
        id: "zerobot",
        displayName: "ZeroBot",
        kind: "framework",
        packageName: "github.com/wdvxdr1123/ZeroBot",
        protocol: "onebot.v11",
        transport: "websocket",
        verification: "handshake",
        evidence: {
            frameworkVersion: "1.8.2",
            adapterVersion: "built-in",
            lastVerifiedAt: "2026-09-02",
            command: "pnpm interop:zerobot",
            checks: [
                "auth-rejection",
                "handshake",
                "private-message",
                "get_login_info",
                "send_private_msg",
            ],
        },
        upstream: "https://github.com/wdvxdr1123/ZeroBot",
        defaultFrameworkOrigin: null,
        limitations: ["群消息、富媒体、重连、反向 WebSocket 与完整动作矩阵仍待验证。"],
    },
    yunzai: {
        id: "yunzai",
        displayName: "云崽 / TRSS-Yunzai",
        kind: "distribution",
        packageName: null,
        protocol: "onebot.v11",
        transport: "reverse-websocket",
        verification: "documented",
        distributionAudit: {
            sourceRevision: "2d1652ac899e8f4338b5310171319e6894b2499c",
            auditedAt: "2026-09-02",
            requiredActions: [
                "_get_group_notice",
                "_send_group_notice",
                "_set_model_show",
                "create_group_file_folder",
                "delete_essence_msg",
                "delete_friend",
                "delete_group_file",
                "delete_msg",
                "download_file",
                "get_cookies",
                "get_csrf_token",
                "get_essence_msg_list",
                "get_forward_msg",
                "get_friend_list",
                "get_friend_msg_history",
                "get_group_file_system_info",
                "get_group_file_url",
                "get_group_files_by_folder",
                "get_group_honor_info",
                "get_group_info",
                "get_group_list",
                "get_group_member_info",
                "get_group_member_list",
                "get_group_msg_history",
                "get_group_root_files",
                "get_guild_channel_list",
                "get_guild_list",
                "get_guild_member_list",
                "get_guild_member_profile",
                "get_guild_meta_by_guest",
                "get_guild_service_profile",
                "get_login_info",
                "get_msg",
                "get_online_clients",
                "get_private_file_url",
                "get_stranger_info",
                "get_version_info",
                "send_group_forward_msg",
                "send_group_sign",
                "send_guild_channel_msg",
                "send_like",
                "send_msg",
                "send_private_forward_msg",
                "set_essence_msg",
                "set_friend_add_request",
                "set_group_add_request",
                "set_group_admin",
                "set_group_ban",
                "set_group_card",
                "set_group_kick",
                "set_group_leave",
                "set_group_name",
                "set_group_portrait",
                "set_group_special_title",
                "set_group_whole_ban",
                "set_qq_avatar",
                "set_qq_profile",
                "upload_group_file",
                "upload_private_file",
            ],
            supportedActions: [
                "delete_friend",
                "delete_msg",
                "get_cookies",
                "get_csrf_token",
                "get_forward_msg",
                "get_friend_list",
                "get_friend_msg_history",
                "get_group_honor_info",
                "get_group_info",
                "get_group_list",
                "get_group_member_info",
                "get_group_member_list",
                "get_group_msg_history",
                "get_login_info",
                "get_msg",
                "get_stranger_info",
                "get_version_info",
                "send_group_forward_msg",
                "send_like",
                "send_msg",
                "send_private_forward_msg",
                "set_friend_add_request",
                "set_group_add_request",
                "set_group_admin",
                "set_group_ban",
                "set_group_card",
                "set_group_kick",
                "set_group_leave",
                "set_group_name",
                "set_group_special_title",
                "set_group_whole_ban",
            ],
            unsupportedActions: [
                "_get_group_notice",
                "_send_group_notice",
                "_set_model_show",
                "create_group_file_folder",
                "delete_essence_msg",
                "delete_group_file",
                "download_file",
                "get_essence_msg_list",
                "get_group_file_system_info",
                "get_group_file_url",
                "get_group_files_by_folder",
                "get_group_root_files",
                "get_guild_channel_list",
                "get_guild_list",
                "get_guild_member_list",
                "get_guild_member_profile",
                "get_guild_meta_by_guest",
                "get_guild_service_profile",
                "get_online_clients",
                "get_private_file_url",
                "send_group_sign",
                "send_guild_channel_msg",
                "set_essence_msg",
                "set_group_portrait",
                "set_qq_avatar",
                "set_qq_profile",
                "upload_group_file",
                "upload_private_file",
            ],
            note: "静态审计 TRSS-Yunzai 官方 OneBotv11 适配器的直接 sendApi 调用；不代表完整进程互操作已验证。",
        },
        upstream: "https://yunzai-bot.com/get-started/platform.html",
        defaultFrameworkOrigin: "http://127.0.0.1:2536",
        limitations: [
            "审计版本的 59 个直接动作中支持 31 个，剩余 28 个集中在文件、群公告、频道与 QQ 资料私有动作。",
            "不同云崽分支的 OneBot 入口与扩展动作并不完全一致；尚未完成固定版本完整进程互操作。",
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
        distributionAudit: {
            sourceRevision: "39ed1ade1469318d53b5beb943f05b89664d294e",
            auditedAt: "2026-09-02",
            requiredActions: [
                "delete_friend",
                "delete_msg",
                "get_forward_msg",
                "get_friend_list",
                "get_group_info",
                "get_group_list",
                "get_group_member_info",
                "get_group_member_list",
                "get_login_info",
                "get_stranger_info",
                "send_group_forward_msg",
                "send_group_msg",
                "send_private_msg",
                "set_friend_add_request",
                "set_group_add_request",
                "set_group_ban",
                "set_group_leave",
            ],
            supportedActions: [
                "delete_friend",
                "delete_msg",
                "get_forward_msg",
                "get_friend_list",
                "get_group_info",
                "get_group_list",
                "get_group_member_info",
                "get_group_member_list",
                "get_login_info",
                "get_stranger_info",
                "send_group_forward_msg",
                "send_group_msg",
                "send_private_msg",
                "set_friend_add_request",
                "set_group_add_request",
                "set_group_ban",
                "set_group_leave",
            ],
            unsupportedActions: [],
            note: "静态审计真寻核心源码中的明确 OneBot API 调用；第三方插件、动态 call_api 与完整进程仍未验证。",
        },
        upstream: "https://github.com/zhenxun-org/zhenxun_bot",
        defaultFrameworkOrigin: "http://127.0.0.1:8080",
        limitations: [
            "审计版本核心源码中的 17 个明确 OneBot 动作均有协议入口，但完整真寻进程与第三方插件仍待验证。",
            "模板不承诺动态 call_api、第三方插件或 QQ 协议端私有字段。",
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
        if (profile.id === "koishi") return onebotsEndpoint.replace(/\/v1$/u, "");
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
        case "melobot":
            return [
                "from melobot import Bot",
                "from melobot.protocols.onebot.v11 import OneBotV11Protocol, WSClient",
                "",
                'bot = Bot("onebots")',
                `bot.add_protocol(OneBotV11Protocol(WSClient("${endpoint}", access_token="${SHARED_TOKEN}")))`,
                "bot.run()",
            ].join("\n");
        case "zerobot":
            return JSON.stringify(
                {
                    zero: {
                        nickname: ["onebots"],
                        command_prefix: "/",
                        super_users: [],
                        ring_len: 4096,
                    },
                    ws: [{ Url: endpoint, AccessToken: SHARED_TOKEN }],
                },
                null,
                2,
            );
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
                    "adapter-satori": { endpoint, token: SHARED_TOKEN },
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
