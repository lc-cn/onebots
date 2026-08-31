import { MatrixError } from "./errors.js";
import type {
    MatrixConfig,
    MatrixCreateRoomResponse,
    MatrixEventEnvelope,
    MatrixEventContext,
    MatrixIdentity,
    MatrixRawEvent,
    MatrixRoomEventPage,
    MatrixSendResponse,
    MatrixUploadResponse,
} from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertMatrixConfig(config: MatrixConfig): void {
    if (!config.account_id?.trim()) throw MatrixError.invalid("Matrix account_id 不能为空");
    requireMatrixId(config.user_id, "user_id", "@");
    const homeserver = parseHomeserverUrl(config.homeserver_url);
    if (homeserver.username || homeserver.password || homeserver.search || homeserver.hash) {
        throw MatrixError.invalid("homeserver_url 不得包含凭据、查询参数或片段");
    }
    const mode = config.receive_mode || "sync";
    if (!(["sync", "appservice", "manual"] as const).includes(mode)) {
        throw MatrixError.invalid("receive_mode 必须是 sync、appservice 或 manual");
    }
    if (mode === "sync" && !config.access_token?.trim()) {
        throw MatrixError.invalid("sync 模式必须提供 access_token");
    }
    if (mode === "appservice") {
        if (!config.as_token?.trim()) throw MatrixError.invalid("appservice 模式必须提供 as_token");
        if (!config.hs_token?.trim()) throw MatrixError.invalid("appservice 模式必须提供 hs_token");
        if (!config.appservice_id?.trim()) {
            throw MatrixError.invalid("appservice 模式必须提供 appservice_id");
        }
    }
    if (!config.access_token?.trim() && !config.as_token?.trim()) {
        throw MatrixError.invalid("必须提供 access_token 或 as_token");
    }
    optionalNonEmptyString(config.device_id, "device_id");
    optionalStringArray(config.event_types, "event_types", value => !/\s/u.test(value));
    optionalStringArray(
        config.direct_room_ids,
        "direct_room_ids",
        value => value.startsWith("!") && value.includes(":"),
    );
    if (
        config.sync_presence !== undefined &&
        !["online", "unavailable", "offline"].includes(config.sync_presence)
    ) {
        throw MatrixError.invalid("sync_presence 必须是 online、unavailable 或 offline");
    }
    if (config.lazy_load_members !== undefined && typeof config.lazy_load_members !== "boolean") {
        throw MatrixError.invalid("lazy_load_members 必须是布尔值");
    }
    positiveInteger(config.sync_timeout_ms, "sync_timeout_ms", 1_000, 120_000);
    positiveInteger(config.sync_retry_min_ms, "sync_retry_min_ms", 100, 60_000);
    positiveInteger(config.sync_retry_max_ms, "sync_retry_max_ms", 100, 600_000);
    positiveInteger(config.initial_sync_limit, "initial_sync_limit", 0, 1_000);
    if (
        config.sync_retry_min_ms !== undefined &&
        config.sync_retry_max_ms !== undefined &&
        config.sync_retry_min_ms > config.sync_retry_max_ms
    ) {
        throw MatrixError.invalid("sync_retry_min_ms 不能大于 sync_retry_max_ms");
    }
    if (
        config.appservice_path &&
        !/^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/u.test(config.appservice_path)
    ) {
        throw MatrixError.invalid("appservice_path 必须是安全的绝对 pathname");
    }
}

export function parseHomeserverUrl(value: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch (error) {
        throw MatrixError.invalid("homeserver_url 不是有效 URL", {
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    const local =
        url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
        throw MatrixError.invalid("homeserver_url 必须使用 HTTPS（本机测试可使用 HTTP）");
    }
    return url;
}

export function parseMatrixEvent(value: unknown): MatrixRawEvent {
    if (
        !isRecord(value) ||
        typeof value.type !== "string" ||
        !value.type ||
        /\s/u.test(value.type) ||
        !isRecord(value.content)
    ) {
        throw MatrixError.invalid("Matrix 事件必须包含 type 与对象 content");
    }
    for (const field of ["event_id", "room_id", "sender", "redacts"] as const) {
        if (value[field] !== undefined && typeof value[field] !== "string") {
            throw MatrixError.invalid(`Matrix 事件 ${field} 必须是字符串`);
        }
        if (value[field] === "") throw MatrixError.invalid(`Matrix 事件 ${field} 不能为空`);
    }
    if (value.state_key !== undefined && typeof value.state_key !== "string") {
        throw MatrixError.invalid("Matrix 事件 state_key 必须是字符串");
    }
    if (
        value.origin_server_ts !== undefined &&
        (!Number.isSafeInteger(value.origin_server_ts) || Number(value.origin_server_ts) < 0)
    ) {
        throw MatrixError.invalid("Matrix 事件 origin_server_ts 必须是非负安全整数");
    }
    if (value.unsigned !== undefined && !isRecord(value.unsigned)) {
        throw MatrixError.invalid("Matrix 事件 unsigned 必须是对象");
    }
    return value as MatrixRawEvent;
}

export function parseMatrixEnvelope(value: unknown): MatrixEventEnvelope {
    if (isRecord(value) && "event" in value) {
        const event = parseMatrixEvent(value.event);
        const roomId = optionalString(value.room_id) || event.room_id;
        const section = optionalString(value.section) || "manual";
        if (!isMatrixSection(section)) throw MatrixError.invalid("Matrix envelope section 无效");
        return {
            event,
            room_id: roomId,
            section,
            is_direct: value.is_direct === true,
            transaction_id: optionalString(value.transaction_id),
        };
    }
    const event = parseMatrixEvent(value);
    return { event, room_id: event.room_id, section: "manual" };
}

export function parseIdentity(value: unknown): MatrixIdentity {
    const record = requireRecord(value, "whoami 响应");
    return {
        user_id: requireString(record.user_id, "whoami.user_id"),
        device_id: optionalString(record.device_id),
        is_guest: typeof record.is_guest === "boolean" ? record.is_guest : undefined,
    };
}

export function parseSendResponse(value: unknown): MatrixSendResponse {
    return { event_id: requireString(requireRecord(value, "发送响应").event_id, "event_id") };
}

export function parseCreateRoomResponse(value: unknown): MatrixCreateRoomResponse {
    return { room_id: requireString(requireRecord(value, "创建房间响应").room_id, "room_id") };
}

export function parseUploadResponse(value: unknown): MatrixUploadResponse {
    const record = requireRecord(value, "媒体上传响应");
    return {
        content_uri: requireString(record.content_uri, "content_uri"),
        blurhash: optionalString(record.blurhash),
    };
}

export function parseRoomEventPage(value: unknown): MatrixRoomEventPage {
    const record = requireRecord(value, "房间历史响应");
    if (!Array.isArray(record.chunk)) throw MatrixError.invalid("房间历史 chunk 必须是数组");
    return {
        start: requireString(record.start, "start"),
        end: optionalString(record.end),
        chunk: record.chunk.map(parseMatrixEvent),
        state: Array.isArray(record.state) ? record.state.map(parseMatrixEvent) : undefined,
    };
}

export function parseEventContext(value: unknown): MatrixEventContext {
    const record = requireRecord(value, "事件上下文响应");
    return {
        event: record.event === undefined ? undefined : parseMatrixEvent(record.event),
        events_before: parseEventArray(record.events_before, "events_before"),
        events_after: parseEventArray(record.events_after, "events_after"),
        state: parseEventArray(record.state, "state"),
        start: optionalString(record.start),
        end: optionalString(record.end),
    };
}

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw MatrixError.invalid(`${field} 必须是对象`);
    return value;
}

export function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) throw MatrixError.invalid(`${field} 必须是非空字符串`);
    return value;
}

export function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function requireMatrixId(value: string, field: string, sigil: string): void {
    if (!value?.startsWith(sigil) || !value.includes(":")) {
        throw MatrixError.invalid(`${field} 必须是完整 Matrix ID`);
    }
}

function parseEventArray(value: unknown, field: string): MatrixRawEvent[] {
    if (!Array.isArray(value)) throw MatrixError.invalid(`${field} 必须是数组`);
    return value.map(parseMatrixEvent);
}

function positiveInteger(value: number | undefined, field: string, min: number, max: number): void {
    if (value === undefined) return;
    if (!Number.isInteger(value) || value < min || value > max) {
        throw MatrixError.invalid(`${field} 必须是 ${min} 到 ${max} 的整数`);
    }
}

function optionalNonEmptyString(value: string | undefined, field: string): void {
    if (value !== undefined && !value.trim()) throw MatrixError.invalid(`${field} 不能为空`);
}

function optionalStringArray(
    value: string[] | undefined,
    field: string,
    predicate: (item: string) => boolean,
): void {
    if (value === undefined) return;
    if (
        !Array.isArray(value) ||
        value.some(item => typeof item !== "string" || !item || !predicate(item))
    ) {
        throw MatrixError.invalid(`${field} 必须是有效的非空字符串数组`);
    }
    if (new Set(value).size !== value.length) {
        throw MatrixError.invalid(`${field} 不能包含重复值`);
    }
}

function isMatrixSection(value: string): value is MatrixEventEnvelope["section"] {
    return [
        "timeline",
        "state",
        "ephemeral",
        "invite_state",
        "leave",
        "presence",
        "to_device",
        "account_data",
        "manual",
        "appservice",
    ].includes(value);
}
