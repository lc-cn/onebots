import type { ControlTransport } from "./control.js";

export interface ControlLogSnapshot {
    source: "gateway";
    text: string;
    truncated: boolean;
    exists: boolean;
}

export const controlLogSources = ["manager", "gateway", "operation"] as const;
export type ControlLogSource = (typeof controlLogSources)[number];

export interface ControlLogQuery {
    source: ControlLogSource;
    /** Opaque cursor returned by a prior query. Omit it to read the latest bounded window. */
    cursor?: string;
}

export interface ControlLogBatch {
    schemaVersion: 1;
    source: ControlLogSource;
    text: string;
    cursor: string;
    truncated: boolean;
    exists: boolean;
    /** The file was replaced or shortened since cursor was issued. */
    reset: boolean;
}

function isControlLogCursor(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const match = /^[a-f0-9]{16}\.([0-9]{1,16})$/u.exec(value);
    return Boolean(match && Number.isSafeInteger(Number(match[1])));
}

export function isControlLogBatch(value: unknown): value is ControlLogBatch {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    try {
        const fields = Object.getOwnPropertyDescriptors(value);
        if (
            Reflect.ownKeys(fields).length !== 7 ||
            !["schemaVersion", "source", "text", "cursor", "truncated", "exists", "reset"].every(
                key => fields[key] && "value" in fields[key],
            )
        )
            return false;
        const source: unknown = fields.source.value;
        const text: unknown = fields.text.value;
        const cursor: unknown = fields.cursor.value;
        return (
            fields.schemaVersion.value === 1 &&
            controlLogSources.includes(source as ControlLogSource) &&
            typeof text === "string" &&
            text.length <= 65536 &&
            new TextEncoder().encode(text).byteLength <= 65536 &&
            isControlLogCursor(cursor) &&
            typeof fields.truncated.value === "boolean" &&
            typeof fields.exists.value === "boolean" &&
            typeof fields.reset.value === "boolean" &&
            (fields.exists.value || (text === "" && !fields.truncated.value))
        );
    } catch {
        return false;
    }
}

export function isControlLogSnapshot(value: unknown): value is ControlLogSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    try {
        const fields = Object.getOwnPropertyDescriptors(value);
        if (
            Reflect.ownKeys(fields).length !== 4 ||
            !["source", "text", "truncated", "exists"].every(
                key => fields[key] && "value" in fields[key],
            )
        )
            return false;
        const source: unknown = fields.source.value;
        const text: unknown = fields.text.value;
        const truncated: unknown = fields.truncated.value;
        const exists: unknown = fields.exists.value;
        return (
            source === "gateway" &&
            typeof text === "string" &&
            text.length <= 65536 &&
            new TextEncoder().encode(text).byteLength <= 196608 &&
            typeof truncated === "boolean" &&
            typeof exists === "boolean" &&
            (exists || (text === "" && !truncated))
        );
    } catch {
        // 外部响应不能执行访问器或将解析异常暴露给客户端。
        return false;
    }
}

/** 移除终端命令、不可见控制符和双向覆盖，保留换行及制表符。 */
export function sanitizeLogText(text: string): string {
    return text
        .replace(/(?:\x1b\]|\x9d)[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c|$)/g, "")
        .replace(/(?:\x1b[P^_X]|[\x90\x98\x9e\x9f])[^\x1b\x9c]*(?:\x1b\\|\x9c|$)/g, "")
        .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\x1b[ -/]*[@-~]/g, "")
        .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "");
}

export class ControlLogClient {
    constructor(private readonly transport: ControlTransport) {}
    async query(query: ControlLogQuery): Promise<ControlLogBatch> {
        if (
            !controlLogSources.includes(query.source) ||
            (query.cursor !== undefined && !isControlLogCursor(query.cursor))
        )
            throw new Error("日志查询参数无效。");
        try {
            const parameters = new URLSearchParams({ source: query.source });
            if (query.cursor) parameters.set("cursor", query.cursor);
            const result: unknown = await this.transport.request(
                "GET",
                `/api/control/logs?${parameters.toString()}`,
            );
            if (!isControlLogBatch(result) || result.source !== query.source)
                throw new Error("invalid");
            return { ...result, text: sanitizeLogText(result.text) };
        } catch {
            throw new Error("无法读取服务日志，请检查管理会话和服务状态。");
        }
    }
    async gateway(): Promise<ControlLogSnapshot> {
        try {
            const result: unknown = await this.transport.request(
                "GET",
                "/api/control/logs/gateway",
            );
            if (!isControlLogSnapshot(result)) throw new Error("invalid");
            return { ...result, text: sanitizeLogText(result.text) };
        } catch {
            throw new Error("无法读取网关日志，请检查管理会话和服务状态。");
        }
    }
}
