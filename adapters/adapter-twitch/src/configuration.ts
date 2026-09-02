import { TwitchError } from "./errors.js";
import { getTwitchEventSubDefinition } from "./eventsub-catalog.js";
import type {
    TwitchConfig,
    TwitchNormalizedSubscription,
    TwitchReceiveMode,
    TwitchSubscriptionConfig,
} from "./types.js";

const TWITCH_API_ORIGIN = "https://api.twitch.tv";
const TWITCH_EVENTSUB_ORIGIN = "wss://eventsub.wss.twitch.tv";

export function assertTwitchConfig(config: TwitchConfig): void {
    if (!config || typeof config !== "object")
        throw TwitchError.invalid("Twitch config 必须是对象");
    required(config.account_id, "account_id");
    required(config.client_id, "client_id");
    required(config.access_token, "access_token");
    assertTwitchId(config.broadcaster_user_id, "broadcaster_user_id");
    if (config.bot_user_id) assertTwitchId(config.bot_user_id, "bot_user_id");
    if (config.moderator_user_id) assertTwitchId(config.moderator_user_id, "moderator_user_id");
    const mode = config.receive_mode || "websocket";
    if (!(["websocket", "webhook", "manual"] as TwitchReceiveMode[]).includes(mode)) {
        throw TwitchError.invalid("receive_mode 必须是 websocket、webhook 或 manual");
    }
    if (config.auto_subscribe !== undefined && typeof config.auto_subscribe !== "boolean") {
        throw TwitchError.invalid("auto_subscribe 必须是布尔值");
    }
    if (mode === "webhook") {
        if (
            typeof config.webhook_secret !== "string" ||
            config.webhook_secret.length < 10 ||
            config.webhook_secret.length > 100
        ) {
            throw TwitchError.invalid("webhook_secret 必须是 10 到 100 个 ASCII 字符");
        }
        if (!/^[\x20-\x7e]+$/u.test(config.webhook_secret)) {
            throw TwitchError.invalid("webhook_secret 只能包含 ASCII 可打印字符");
        }
        if (config.auto_subscribe !== false)
            assertHttpsUrl(config.webhook_callback_url, "webhook_callback_url");
        if (config.http_path !== undefined) assertHttpPath(config.http_path);
    }
    parseTwitchApiBaseUrl(config.api_base_url);
    parseTwitchEventSubUrl(config.eventsub_websocket_url, config.keepalive_timeout_seconds);
    if (config.subscriptions !== undefined && !Array.isArray(config.subscriptions)) {
        throw TwitchError.invalid("subscriptions 必须是数组");
    }
    for (const item of config.subscriptions || []) normalizeSubscription(item, config);
    positiveInteger(config.max_response_bytes, "max_response_bytes", 1024, 52_428_800);
    positiveInteger(config.connect_timeout_ms, "connect_timeout_ms", 100, 120_000);
    positiveInteger(config.reconnect_initial_delay_ms, "reconnect_initial_delay_ms", 100, 60_000);
    positiveInteger(config.reconnect_max_delay_ms, "reconnect_max_delay_ms", 100, 300_000);
    positiveInteger(config.webhook_tolerance_seconds, "webhook_tolerance_seconds", 10, 3600);
    const reconnectInitial = config.reconnect_initial_delay_ms || 1_000;
    const reconnectMaximum = config.reconnect_max_delay_ms || 30_000;
    if (reconnectInitial > reconnectMaximum) {
        throw TwitchError.invalid("reconnect_initial_delay_ms 不能大于 reconnect_max_delay_ms");
    }
}

export function parseTwitchApiBaseUrl(value?: string): URL {
    const url = parseUrl(value || `${TWITCH_API_ORIGIN}/helix/`, "api_base_url");
    if (url.protocol !== "https:" && !isLoopback(url.hostname)) {
        throw TwitchError.invalid("api_base_url 必须使用 HTTPS（本地回环测试除外）");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw TwitchError.invalid("api_base_url 不得包含凭据、查询参数或片段");
    }
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url;
}

export function parseTwitchEventSubUrl(value?: string, keepalive?: number): URL {
    const url = parseUrl(value || `${TWITCH_EVENTSUB_ORIGIN}/ws`, "eventsub_websocket_url");
    if (url.protocol !== "wss:" && !(url.protocol === "ws:" && isLoopback(url.hostname))) {
        throw TwitchError.invalid("eventsub_websocket_url 必须使用 WSS（本地回环测试除外）");
    }
    if (url.username || url.password || url.hash) {
        throw TwitchError.invalid("eventsub_websocket_url 不得包含凭据或片段");
    }
    if (keepalive !== undefined) {
        if (!Number.isSafeInteger(keepalive) || keepalive < 10 || keepalive > 600) {
            throw TwitchError.invalid("keepalive_timeout_seconds 必须是 10 到 600 的整数");
        }
        url.searchParams.set("keepalive_timeout_seconds", String(keepalive));
    }
    return url;
}

/** 仅允许 Helix 根目录内的相对资源，拒绝绝对 URL、查询注入和编码路径穿越。 */
export function assertTwitchApiPath(path: string): string {
    const value = path.trim();
    if (
        !value ||
        value.startsWith("/") ||
        value.includes("//") ||
        value.includes("?") ||
        value.includes("#") ||
        value.includes("\\") ||
        !/^[a-z0-9_./-]+$/iu.test(value)
    ) {
        throw TwitchError.invalid("Helix path 必须是无 query/hash 的相对资源路径");
    }
    if (
        value.split("/").some(segment => {
            return (
                !segment ||
                segment === "." ||
                segment === ".." ||
                /[\u0000-\u001f\u007f]/u.test(segment)
            );
        })
    ) {
        throw TwitchError.invalid("Helix path 不得包含路径穿越");
    }
    return value;
}

export function normalizeSubscription(
    input: TwitchSubscriptionConfig,
    config: Pick<
        TwitchConfig,
        "broadcaster_user_id" | "bot_user_id" | "moderator_user_id" | "client_id" | "receive_mode"
    >,
): TwitchNormalizedSubscription {
    if (!input || typeof input !== "object")
        throw TwitchError.invalid("subscriptions 项必须是对象");
    const type = subscriptionType(input.type);
    const definition = getTwitchEventSubDefinition(type);
    if (!definition) throw TwitchError.invalid(`EventSub 类型 ${type} 不在当前官方稳定目录中`);
    const version = input.version?.trim() || definition.versions.at(-1) || "1";
    if (!definition.versions.includes(version)) {
        throw TwitchError.invalid(
            `订阅 ${type} 的稳定 version 必须是 ${definition.versions.join("、")}`,
        );
    }
    const receiveMode = config.receive_mode || "websocket";
    if (
        receiveMode !== "manual" &&
        definition.transports &&
        !definition.transports.includes(receiveMode)
    ) {
        throw TwitchError.invalid(`EventSub 类型 ${type} 不支持 ${receiveMode} transport`);
    }
    const condition = conditionFor(type, input, config, definition.condition);
    if (!Object.keys(condition).length)
        throw TwitchError.invalid(`订阅 ${type} 无法推导 condition`);
    return {
        type,
        version,
        condition,
        ...(definition.batching ? { is_batching_enabled: true as const } : {}),
    };
}

export function expandSubscriptions(config: TwitchConfig): TwitchNormalizedSubscription[] {
    const entries = config.subscriptions?.length
        ? config.subscriptions
        : [{ type: "channel.chat.message" }];
    const unique = new Map<string, TwitchNormalizedSubscription>();
    for (const entry of entries) {
        const item = normalizeSubscription(entry, config);
        unique.set(`${item.type}:${item.version}:${stableCondition(item.condition)}`, item);
    }
    return [...unique.values()];
}

function conditionFor(
    type: string,
    input: TwitchSubscriptionConfig,
    config: Pick<
        TwitchConfig,
        "broadcaster_user_id" | "bot_user_id" | "moderator_user_id" | "client_id"
    >,
    profile:
        | "broadcaster"
        | "chat"
        | "moderator"
        | "raid"
        | "user"
        | "authorization"
        | "conduit"
        | "drop"
        | "extension",
): Record<string, string> {
    const allowed = conditionKeys(profile, type);
    const known = new Set(["type", "version", ...ALL_CONDITION_KEYS]);
    const unknown = Object.keys(input).find(key => !known.has(key));
    if (unknown) throw TwitchError.invalid(`订阅 ${type} 包含未知字段 ${unknown}`);
    const irrelevant = ALL_CONDITION_KEYS.find(
        key => !allowed.has(key) && typeof input[key] === "string" && input[key]?.trim(),
    );
    if (irrelevant) throw TwitchError.invalid(`订阅 ${type} 不接受 condition.${irrelevant}`);
    const supplied = Object.fromEntries(
        [...allowed].flatMap(key => {
            const value = input[key];
            return typeof value === "string" && value.trim() ? [[key, value]] : [];
        }),
    ) as Record<string, string>;
    const broadcaster = config.broadcaster_user_id;
    const bot = config.bot_user_id || broadcaster;
    const moderator = config.moderator_user_id || broadcaster;
    if (profile === "raid") {
        const raid = Object.keys(supplied).length
            ? supplied
            : { to_broadcaster_user_id: broadcaster };
        if (Boolean(raid.from_broadcaster_user_id) === Boolean(raid.to_broadcaster_user_id)) {
            throw TwitchError.invalid(`订阅 ${type} 必须且只能提供一个 raid 来源或目标 ID`);
        }
        return validateCondition(raid);
    }
    if (profile === "authorization") {
        return validateCondition({ client_id: config.client_id, ...supplied });
    }
    if (profile === "conduit") {
        return validateCondition({ client_id: config.client_id, ...supplied });
    }
    if (profile === "drop") {
        const result = validateCondition(supplied);
        if (!result.organization_id) {
            throw TwitchError.invalid(`订阅 ${type} 必须提供 organization_id`);
        }
        return result;
    }
    if (profile === "extension") {
        return validateCondition({ extension_client_id: config.client_id, ...supplied });
    }
    if (profile === "user") return validateCondition({ user_id: bot, ...supplied });
    if (profile === "chat") {
        return validateCondition({ broadcaster_user_id: broadcaster, user_id: bot, ...supplied });
    }
    if (profile === "moderator") {
        return validateCondition({
            broadcaster_user_id: broadcaster,
            moderator_user_id: moderator,
            ...supplied,
        });
    }
    return validateCondition({ broadcaster_user_id: broadcaster, ...supplied });
}

const ALL_CONDITION_KEYS = [
    "broadcaster_user_id",
    "user_id",
    "moderator_user_id",
    "from_broadcaster_user_id",
    "to_broadcaster_user_id",
    "reward_id",
    "organization_id",
    "category_id",
    "campaign_id",
    "client_id",
    "conduit_id",
    "extension_client_id",
] as const satisfies readonly (keyof TwitchSubscriptionConfig)[];

function conditionKeys(
    profile: Parameters<typeof conditionFor>[3],
    type: string,
): ReadonlySet<(typeof ALL_CONDITION_KEYS)[number]> {
    if (profile === "chat") return new Set(["broadcaster_user_id", "user_id"]);
    if (profile === "moderator") {
        return new Set(["broadcaster_user_id", "moderator_user_id"]);
    }
    if (profile === "raid") {
        return new Set(["from_broadcaster_user_id", "to_broadcaster_user_id"]);
    }
    if (profile === "user") return new Set(["user_id"]);
    if (profile === "authorization") return new Set(["client_id"]);
    if (profile === "conduit") return new Set(["client_id", "conduit_id"]);
    if (profile === "drop") {
        return new Set(["organization_id", "category_id", "campaign_id"]);
    }
    if (profile === "extension") return new Set(["extension_client_id"]);
    return new Set(
        type.startsWith("channel.channel_points_custom_reward")
            ? ["broadcaster_user_id", "reward_id"]
            : ["broadcaster_user_id"],
    );
}

function validateCondition(value: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value)) {
        if (!/^[a-z][a-z0-9_]*$/u.test(key))
            throw TwitchError.invalid(`无效 EventSub condition 字段 ${key}`);
        const text = raw.trim();
        if (!text || text.length > 512) throw TwitchError.invalid(`EventSub condition.${key} 无效`);
        result[key] = text;
    }
    return result;
}

function subscriptionType(value: unknown): string {
    if (typeof value !== "string" || !/^[a-z][a-z0-9_.]{2,99}$/u.test(value)) {
        throw TwitchError.invalid("EventSub subscription type 无效");
    }
    return value;
}

function assertTwitchId(value: unknown, field: string): void {
    if (typeof value !== "string" || !/^\d+$/u.test(value)) {
        throw TwitchError.invalid(`${field} 必须是 Twitch 数字 ID`);
    }
}

function required(value: unknown, field: string): void {
    if (typeof value !== "string" || !value.trim()) {
        throw TwitchError.invalid(`${field} 不能为空`);
    }
}

function positiveInteger(value: number | undefined, field: string, min: number, max: number): void {
    if (value === undefined) return;
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw TwitchError.invalid(`${field} 必须是 ${min} 到 ${max} 的整数`);
    }
}

function parseUrl(value: string, field: string): URL {
    try {
        return new URL(value);
    } catch {
        throw TwitchError.invalid(`${field} 不是有效 URL`);
    }
}

function assertHttpsUrl(value: string | undefined, field: string): void {
    if (!value) throw TwitchError.invalid(`${field} 不能为空`);
    const url = parseUrl(value, field);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
        throw TwitchError.invalid(`${field} 必须使用 HTTPS（本地回环测试除外）`);
    }
    if (!isLoopback(url.hostname) && url.port && url.port !== "443") {
        throw TwitchError.invalid(`${field} 的公网 HTTPS callback 必须使用 443 端口`);
    }
    if (url.username || url.password || url.hash) {
        throw TwitchError.invalid(`${field} 不得包含凭据或片段`);
    }
}

export function assertHttpPath(value: string): string {
    if (
        !value.startsWith("/") ||
        value.startsWith("//") ||
        value.includes("?") ||
        value.includes("#") ||
        value.includes("\\") ||
        /[\u0000-\u001f\u007f]/u.test(value)
    ) {
        throw TwitchError.invalid("http_path 必须是无 query/hash 的绝对路径");
    }
    const normalized = value === "/" ? value : value.replace(/\/+$/u, "");
    for (const segment of normalized.split("/").slice(1)) {
        let decoded: string;
        try {
            decoded = decodeURIComponent(segment);
        } catch {
            throw TwitchError.invalid("http_path 包含无效百分号编码");
        }
        if (
            !decoded ||
            decoded === "." ||
            decoded === ".." ||
            decoded.includes("/") ||
            decoded.includes("\\")
        ) {
            throw TwitchError.invalid("http_path 包含无效路径段");
        }
    }
    return normalized;
}

function isLoopback(hostname: string): boolean {
    return (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname === "[::1]"
    );
}

function stableCondition(condition: Record<string, string>): string {
    return Object.entries(condition)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
}
