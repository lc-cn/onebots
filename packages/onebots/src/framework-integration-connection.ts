import yaml from "js-yaml";
import {
    FrameworkIntegrationRegistry,
    type FrameworkConfigRenderContext,
    type FrameworkConnectionCheck,
    type FrameworkConnectionPlan,
    type FrameworkConnectionRequest,
    type FrameworkIntegrationContext,
    type FrameworkProfile,
} from "./framework-integration-types.js";

export const SHARED_TOKEN = "<shared-token>";

export function listFrameworkProfiles(): readonly FrameworkProfile[] {
    return FrameworkIntegrationRegistry.list().map(provider => provider.profile);
}

export function getFrameworkProfile(id: string): FrameworkProfile | undefined {
    return FrameworkIntegrationRegistry.get(id)?.profile;
}

export function createFrameworkConnectionPlan(
    request: FrameworkConnectionRequest,
): FrameworkConnectionPlan {
    const provider = FrameworkIntegrationRegistry.get(request.framework);
    if (!provider) throw new TypeError(`未知机器人框架：${request.framework}`);
    const profile = provider.profile;
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
    const integrationContext = { profile, onebotsEndpoint, frameworkOrigin };
    const endpoint = provider.resolveEndpoint
        ? provider.resolveEndpoint(integrationContext)
        : resolveDefaultEndpoint(integrationContext);
    const onebotsConfig = renderOnebotsConfig(profile, account.key, endpoint);
    const frameworkConfig = provider.renderFrameworkConfig({ ...integrationContext, endpoint });

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

function resolveDefaultEndpoint({
    profile,
    onebotsEndpoint,
    frameworkOrigin,
}: FrameworkIntegrationContext): string {
    if (profile.transport !== "reverse-websocket") {
        if (profile.id === "koishi") return onebotsEndpoint.replace(/\/v1$/u, "");
        return profile.transport === "websocket" && profile.protocol.startsWith("onebot")
            ? toWebSocketUrl(onebotsEndpoint)
            : onebotsEndpoint;
    }
    const path = profile.id === "yunzai" ? "/OneBotv11" : "/onebot/v11/ws";
    return resolveReverseFrameworkEndpoint(frameworkOrigin!, path);
}

export function resolveReverseFrameworkEndpoint(frameworkOrigin: URL, path: string): string {
    const basePath = frameworkOrigin!.pathname.replace(/\/+$/u, "");
    return toWebSocketUrl(new URL(`${basePath}${path}`, frameworkOrigin).toString());
}

function renderOnebotsConfig(
    profile: FrameworkProfile,
    accountKey: string,
    endpoint: string,
): string {
    const credentialKey = profile.protocol === "satori.v1" ? "token" : "access_token";
    const protocolConfig: Record<string, unknown> = { [credentialKey]: SHARED_TOKEN };
    if (profile.transport === "reverse-websocket") {
        protocolConfig.use_http = false;
        protocolConfig.use_ws = false;
        protocolConfig.ws_reverse = [endpoint];
    } else {
        protocolConfig.use_http = ["satori.v1", "milky.v1"].includes(profile.protocol);
        protocolConfig.use_ws = true;
    }
    return yaml.dump({ [accountKey]: { [profile.protocol]: protocolConfig } }, { noRefs: true });
}

export function renderBuiltinFrameworkConfig({
    profile,
    onebotsEndpoint,
    endpoint,
}: FrameworkConfigRenderContext): string {
    switch (profile.id) {
        case "nonebot":
        case "zhenxun":
            return [
                "# .env",
                "DRIVER=~fastapi+~websockets",
                `ONEBOT_V11_ACCESS_TOKEN=${SHARED_TOKEN}`,
                `# OneBots 主动连接 ${endpoint}`,
            ].join("\n");
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
        case "kovi": {
            const url = new URL(endpoint);
            return [
                "[onebot.server]",
                `host = ${JSON.stringify(url.hostname)}`,
                `port = ${url.port || (url.protocol === "wss:" ? "443" : "80")}`,
                `access_token = ${JSON.stringify(SHARED_TOKEN)}`,
                `secure = ${url.protocol === "wss:"}`,
                `path = ${JSON.stringify(url.pathname)}`,
                "all_in_one = false",
            ].join("\n");
        }
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
        default:
            throw new TypeError(`内置框架 ${profile.id} 缺少配置渲染器`);
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
