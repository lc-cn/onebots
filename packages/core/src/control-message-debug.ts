import type { ControlTransport } from "./control.js";

export type ControlMessageDebugJson =
    | null
    | boolean
    | number
    | string
    | ControlMessageDebugJson[]
    | { [key: string]: ControlMessageDebugJson };

/** 单个网关实例内的消息旁路记录，payload 不参与平台或协议处理。 */
export interface ControlMessageDebugEntry {
    seq: number;
    time: number;
    direction: "inbound" | "outbound";
    platform: string;
    account_id: string;
    protocol?: string;
    version?: string;
    payload: ControlMessageDebugJson;
}

/** HTTP 历史与 SSE data 使用相同的完整快照；seq 只在此实例内有效。 */
export interface ControlMessageDebugSnapshot {
    gatewayInstanceId: string;
    entries: ControlMessageDebugEntry[];
}

export interface ControlMessageDebugClearReceipt {
    gatewayInstanceId: string;
    clearedCount: number;
    clearedThroughSeq: number;
}

const uuid = (v: unknown): boolean =>
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const integer = (v: unknown): v is number =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function closed(v: unknown, fields: string[]): v is Record<string, unknown> {
    return (
        !!v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(v)) &&
        Reflect.ownKeys(v).length === fields.length &&
        fields.every(key => {
            const d = Object.getOwnPropertyDescriptor(v, key);
            return d?.enumerable && "value" in d;
        })
    );
}
/** Validate without invoking getters or JSON hooks; bound depth and visited nodes before encoding. */
function jsonData(v: unknown, budget: { left: number }, depth = 0): boolean {
    if (--budget.left < 0 || depth > 64) return false;
    if (v === null || typeof v === "boolean" || typeof v === "string") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (!v || typeof v !== "object") return false;
    if (Array.isArray(v)) {
        if (
            Object.getPrototypeOf(v) !== Array.prototype ||
            v.length > 16384 ||
            Reflect.ownKeys(v).length !== v.length + 1
        )
            return false;
        for (let i = 0; i < v.length; i++) {
            const d = Object.getOwnPropertyDescriptor(v, String(i));
            if (!d?.enumerable || !("value" in d) || !jsonData(d.value, budget, depth + 1))
                return false;
        }
        return true;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) return false;
    for (const key of Reflect.ownKeys(v)) {
        if (typeof key !== "string") return false;
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (!d?.enumerable || !("value" in d) || !jsonData(d.value, budget, depth + 1))
            return false;
    }
    return true;
}
function frame(v: unknown, max: number): boolean {
    return new TextEncoder().encode(JSON.stringify(v)).length <= max;
}
export function isControlMessageDebugEntry(v: unknown): v is ControlMessageDebugEntry {
    try {
        if (!v || typeof v !== "object") return false;
        const optional = ["protocol", "version"].filter(key => Object.hasOwn(v, key));
        return (
            closed(v, [
                "seq",
                "time",
                "direction",
                "platform",
                "account_id",
                "payload",
                ...optional,
            ]) &&
            integer(v.seq) &&
            v.seq > 0 &&
            integer(v.time) &&
            (v.direction === "inbound" || v.direction === "outbound") &&
            typeof v.platform === "string" &&
            !!v.platform.trim() &&
            typeof v.account_id === "string" &&
            optional.every(key => typeof v[key] === "string") &&
            jsonData(v.payload, { left: 16384 }) &&
            frame(v, 16384)
        );
    } catch {
        return false; /* Invalid transport data, never execute or log message payloads. */
    }
}

export function isControlMessageDebugSnapshot(v: unknown): v is ControlMessageDebugSnapshot {
    try {
        if (
            !closed(v, ["gatewayInstanceId", "entries"]) ||
            !uuid(v.gatewayInstanceId) ||
            !Array.isArray(v.entries) ||
            v.entries.length > 300 ||
            Object.getPrototypeOf(v.entries) !== Array.prototype ||
            Reflect.ownKeys(v.entries).length !== v.entries.length + 1
        )
            return false;
        let previous = 0;
        for (let i = 0; i < v.entries.length; i++) {
            const descriptor = Object.getOwnPropertyDescriptor(v.entries, String(i));
            if (
                !descriptor?.enumerable ||
                !("value" in descriptor) ||
                !isControlMessageDebugEntry(descriptor.value) ||
                descriptor.value.seq <= previous
            )
                return false;
            previous = descriptor.value.seq;
        }
        return frame(v, 300 * 16384 + 4096);
    } catch {
        return false; // 不可信响应只拒绝，不记录消息内容。
    }
}

export function isControlMessageDebugClearReceipt(
    v: unknown,
): v is ControlMessageDebugClearReceipt {
    try {
        return (
            closed(v, ["gatewayInstanceId", "clearedCount", "clearedThroughSeq"]) &&
            uuid(v.gatewayInstanceId) &&
            integer(v.clearedCount) &&
            v.clearedCount <= 300 &&
            integer(v.clearedThroughSeq) &&
            v.clearedCount <= v.clearedThroughSeq
        );
    } catch {
        return false; // 不可信响应只拒绝，不记录消息内容。
    }
}

export async function messageDebugHistory(
    transport: ControlTransport,
): Promise<ControlMessageDebugSnapshot> {
    const result: unknown = await transport.request("GET", "/api/control/message-debug/history");
    if (!isControlMessageDebugSnapshot(result)) throw new Error("消息历史响应无效");
    return result;
}

/** 清空可能已执行；响应丢失或实例不一致时绝不自动重试。 */
export async function clearMessageDebug(
    transport: ControlTransport,
    expectedGatewayInstanceId: string,
): Promise<ControlMessageDebugClearReceipt> {
    if (!uuid(expectedGatewayInstanceId)) throw new Error("网关实例标识无效");
    const result: unknown = await transport.request("POST", "/api/control/message-debug/clear", {
        expectedGatewayInstanceId,
    });
    if (
        !isControlMessageDebugClearReceipt(result) ||
        result.gatewayInstanceId !== expectedGatewayInstanceId
    )
        throw new Error("消息历史清空结果未确认，请重新读取历史，不要自动重试");
    return result;
}
