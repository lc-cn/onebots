import { MattermostError } from "./errors.js";
import type { MattermostConfig } from "./types.js";

/** 在建立网络连接前拒绝模糊或危险的账号配置。 */
export function assertMattermostConfig(config: MattermostConfig): void {
    requireNonEmpty(config.account_id, "account_id");
    requireNonEmpty(config.access_token, "access_token");
    parseMattermostServerUrl(config.server_url);
    const mode = config.receive_mode || "websocket";
    if (mode !== "websocket" && mode !== "manual") {
        throw MattermostError.invalid("receive_mode 必须是 websocket 或 manual");
    }
    stringList(config.event_types, "event_types");
    idList(config.team_ids, "team_ids");
    idList(config.channel_ids, "channel_ids");
    integer(config.reconnect_initial_delay_ms, "reconnect_initial_delay_ms", 100, 60_000);
    integer(config.reconnect_max_delay_ms, "reconnect_max_delay_ms", 100, 300_000);
    integer(config.connect_timeout_ms, "connect_timeout_ms", 1_000, 120_000);
    integer(config.max_response_bytes, "max_response_bytes", 1_024, 50 * 1024 * 1024);
    if (
        config.reconnect_initial_delay_ms !== undefined &&
        config.reconnect_max_delay_ms !== undefined &&
        config.reconnect_initial_delay_ms > config.reconnect_max_delay_ms
    ) {
        throw MattermostError.invalid("reconnect_initial_delay_ms 不能大于 reconnect_max_delay_ms");
    }
}

export function parseMattermostServerUrl(value: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch (error) {
        throw MattermostError.invalid("server_url 不是有效 URL", {
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
        throw MattermostError.invalid("server_url 必须使用 HTTPS（本机测试可使用 HTTP）");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw MattermostError.invalid("server_url 不得包含凭据、查询参数或片段");
    }
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url;
}

export function assertMattermostApiPath(path: string): string {
    if (
        !path ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.includes("?") ||
        path.includes("#") ||
        /[\u0000-\u001f\u007f]/u.test(path)
    ) {
        throw MattermostError.invalid("Mattermost API path 必须是无查询参数的相对路径");
    }
    const segments = path.split("/");
    if (segments.some(segment => !isSafeSegment(segment))) {
        throw MattermostError.invalid("Mattermost API path 包含无效路径段");
    }
    return path;
}

function isSafeSegment(segment: string): boolean {
    if (!segment || segment === "." || segment === "..") return false;
    try {
        const decoded = decodeURIComponent(segment);
        return (
            decoded !== "." && decoded !== ".." && !decoded.includes("/") && !decoded.includes("\\")
        );
    } catch {
        return false;
    }
}

function requireNonEmpty(value: string, field: string): void {
    if (typeof value !== "string" || !value.trim()) {
        throw MattermostError.invalid(`${field} 不能为空`);
    }
}

function stringList(value: string[] | undefined, field: string): void {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some(item => !item || /\s/u.test(item))) {
        throw MattermostError.invalid(`${field} 必须是无空白的非空字符串数组`);
    }
    if (new Set(value).size !== value.length) {
        throw MattermostError.invalid(`${field} 不能包含重复值`);
    }
}

function idList(value: string[] | undefined, field: string): void {
    stringList(value, field);
    if (value?.some(item => !/^[a-z0-9]+$/u.test(item))) {
        throw MattermostError.invalid(`${field} 包含无效 Mattermost ID`);
    }
}

function integer(value: number | undefined, field: string, min: number, max: number): void {
    if (value === undefined) return;
    if (!Number.isInteger(value) || value < min || value > max) {
        throw MattermostError.invalid(`${field} 必须是 ${min} 到 ${max} 的整数`);
    }
}
