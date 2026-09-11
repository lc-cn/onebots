import { isControlMessageDebugEntry, isControlMessageDebugClearReceipt } from "@onebots/core/control";
import type { MessageDebugEntry, MessageDebugClearReceipt } from "./message-debug-types.js";
import type { GatewayIdentity } from "./contracts.js";

export interface GatewayMessageDebugRequest extends GatewayIdentity {
    type: "gateway.message-debug";
    requestId: string;
    action: "history" | "clear";
}
interface ReplyBase extends GatewayIdentity {
    type: "gateway.message-debug.result";
    requestId: string;
}
export type GatewayMessageDebugReply = ReplyBase &
    (
        | { action: "history"; outcome: "succeeded"; result: { entries: MessageDebugEntry[] } }
        | { action: "clear"; outcome: "succeeded"; result: MessageDebugClearReceipt }
        | { action: "history" | "clear"; outcome: "rejected" }
    );
const keys = [
    "type",
    "protocolVersion",
    "controlInstanceId",
    "gatewayInstanceId",
    "requestId",
    "action",
];
const uuid = (v: unknown): boolean =>
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
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
function identity(v: Record<string, unknown>): boolean {
    return (
        v.protocolVersion === 1 &&
        uuid(v.controlInstanceId) &&
        uuid(v.gatewayInstanceId) &&
        uuid(v.requestId)
    );
}
function frame(v: unknown, max: number): boolean {
    return Buffer.byteLength(JSON.stringify(v)) <= max;
}
export function isGatewayMessageDebugEntry(v: unknown): v is MessageDebugEntry {
    return isControlMessageDebugEntry(v);
}
export function isGatewayMessageDebugRequest(v: unknown): v is GatewayMessageDebugRequest {
    try {
        return (
            closed(v, keys) &&
            v.type === "gateway.message-debug" &&
            identity(v) &&
            (v.action === "history" || v.action === "clear") &&
            frame(v, 4096)
        );
    } catch {
        return false; /* Malformed IPC is rejected without side effects. */
    }
}
export function isGatewayMessageDebugReply(v: unknown): v is GatewayMessageDebugReply {
    try {
        if (!v || typeof v !== "object") return false;
        const result = Object.hasOwn(v, "result");
        if (
            !closed(v, [...keys, "outcome", ...(result ? ["result"] : [])]) ||
            v.type !== "gateway.message-debug.result" ||
            !identity(v) ||
            (v.action !== "history" && v.action !== "clear")
        )
            return false;
        if (v.outcome === "rejected") return !result;
        if (v.outcome !== "succeeded" || !result) return false;
        if (v.action === "clear")
            return (
                closed(v.result, ["clearedCount", "clearedThroughSeq"]) &&
                isControlMessageDebugClearReceipt({ ...v.result, gatewayInstanceId: v.gatewayInstanceId }) &&
                frame(v, 4096)
            );
        if (
            !closed(v.result, ["entries"]) ||
            !Array.isArray(v.result.entries) ||
            v.result.entries.length > 300
        )
            return false;
        const entries = v.result.entries;
        if (
            Object.getPrototypeOf(entries) !== Array.prototype ||
            Reflect.ownKeys(entries).length !== entries.length + 1
        )
            return false;
        let previous = 0;
        for (let i = 0; i < entries.length; i++) {
            const d = Object.getOwnPropertyDescriptor(entries, String(i));
            if (
                !d?.enumerable ||
                !("value" in d) ||
                !isGatewayMessageDebugEntry(d.value) ||
                d.value.seq <= previous
            )
                return false;
            previous = d.value.seq;
        }
        return frame(v, 300 * 16384 + 4096);
    } catch {
        return false; /* Malformed IPC is rejected without side effects. */
    }
}
