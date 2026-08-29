import { ZULIP_EVENT_TYPES, type ZulipConfig } from "./types.js";
import { ZulipError } from "./errors.js";

const EVENT_TYPES: ReadonlySet<string> = new Set(ZULIP_EVENT_TYPES);

/** 在创建传输或发起认证请求前闭合 Zulip 配置。 */
export function assertZulipConfig(config: ZulipConfig): void {
    resolveZulipReceiveMode(config);
    for (const [name, value] of [
        ["account_id", config.account_id],
        ["server_url", config.server_url],
        ["email", config.email],
        ["api_key", config.api_key],
    ] as const) {
        if (!value?.trim()) invalidConfig(`${name} 不能为空`);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) {
        invalidConfig("email 必须是有效邮箱地址");
    }
    assertServerUrl(config.server_url);

    const queue = config.event_queue;
    if (queue && "enabled" in queue) {
        invalidConfig("event_queue.enabled 已移除，请使用顶层 receive_mode");
    }
    if (queue?.event_types) {
        const unique = new Set<string>();
        for (const eventType of queue.event_types) {
            if (!EVENT_TYPES.has(eventType)) invalidConfig(`不支持事件类型 ${eventType}`);
            if (unique.has(eventType)) invalidConfig(`事件类型 ${eventType} 重复`);
            unique.add(eventType);
        }
    }
    assertDelay(queue?.retry_initial_delay_ms, "retry_initial_delay_ms", 100);
    assertDelay(queue?.retry_max_delay_ms, "retry_max_delay_ms", 1_000);
    if (
        queue?.retry_initial_delay_ms !== undefined &&
        queue.retry_max_delay_ms !== undefined &&
        queue.retry_initial_delay_ms > queue.retry_max_delay_ms
    ) {
        invalidConfig("retry_initial_delay_ms 不能大于 retry_max_delay_ms");
    }
    if (config.proxy?.url !== undefined) assertUrl(config.proxy.url, "proxy.url");
}

export function resolveZulipReceiveMode(config: ZulipConfig): "event_queue" | "manual" {
    const mode = config.receive_mode || "event_queue";
    if (mode !== "event_queue" && mode !== "manual") {
        invalidConfig("receive_mode 仅支持 event_queue 或 manual");
    }
    return mode;
}

function assertServerUrl(value: string): void {
    const url = assertUrl(value, "server_url");
    const loopback =
        url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
        invalidConfig("server_url 必须使用 HTTPS；本机回环地址可使用 HTTP");
    }
    if (url.username || url.password || url.search || url.hash) {
        invalidConfig("server_url 不能包含认证信息、查询参数或片段");
    }
    if (/\/api\/v1\/?$/.test(url.pathname)) {
        invalidConfig("server_url 应填写组织根地址，不能包含 /api/v1");
    }
}

function assertUrl(value: string, name: string): URL {
    try {
        return new URL(value);
    } catch {
        invalidConfig(`${name} 必须是有效 URL`);
    }
}

function assertDelay(value: number | undefined, name: string, minimum: number): void {
    if (value !== undefined && (!Number.isInteger(value) || value < minimum)) {
        invalidConfig(`${name} 必须是大于等于 ${minimum} 的整数`);
    }
}

function invalidConfig(message: string): never {
    throw new ZulipError(`Zulip 配置无效：${message}`, { code: "ZULIP_INVALID_CONFIG" });
}
