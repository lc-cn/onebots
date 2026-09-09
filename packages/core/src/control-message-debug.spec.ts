import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ControlClient, type ControlTransport } from "./control.js";
import {
    isControlMessageDebugEntry,
    isControlMessageDebugSnapshot,
    isControlMessageDebugClearReceipt,
} from "./control-message-debug.js";

const entry = () => ({
    seq: 1,
    time: 1,
    direction: "inbound",
    platform: "mock",
    account_id: "00123",
    payload: { user_id: "00123", numeric: 123, text: "中文", list: [null, true] },
});
const snapshot = () => ({ gatewayInstanceId: randomUUID(), entries: [entry()] });

describe("message debug control contract", () => {
    it("preserves JSON payload and instance-scoped sequence numbers", async () => {
        const data = snapshot();
        const request = vi.fn<ControlTransport["request"]>().mockResolvedValue(data);
        expect(await new ControlClient({ request }).messageDebugHistory()).toEqual(data);
        expect(request).toHaveBeenCalledExactlyOnceWith(
            "GET",
            "/api/control/message-debug/history",
        );
        expect(isControlMessageDebugSnapshot({ ...data, entries: [] })).toBe(true);
        expect(
            isControlMessageDebugEntry({
                ...entry(),
                direction: "outbound",
                protocol: "onebot",
                version: "v11",
            }),
        ).toBe(true);
    });
    it("rejects excessive entries, unordered sequences and non-JSON or oversized payloads", () => {
        const base = snapshot();
        for (const entries of [
            Array.from({ length: 301 }, (_, index) => ({ ...entry(), seq: index + 1 })),
            [entry(), entry()],
            [{ ...entry(), seq: 2 }, entry()],
            [{ ...entry(), seq: 0 }],
            [{ ...entry(), time: -1 }],
            [{ ...entry(), payload: "中".repeat(6000) }],
            [{ ...entry(), payload: { invalid: undefined } }],
            [{ ...entry(), payload: { invalid: NaN } }],
            [{ ...entry(), payload: new Date() }],
            [{ ...entry(), payload: { invalid: 1n } }],
            [{ ...entry(), extra: true }],
            new Array(1),
        ])
            expect(isControlMessageDebugSnapshot({ ...base, entries })).toBe(false);
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        expect(isControlMessageDebugEntry({ ...entry(), payload: cycle })).toBe(false);
        expect(isControlMessageDebugSnapshot({ ...base, gatewayInstanceId: "invalid" })).toBe(
            false,
        );
        expect(isControlMessageDebugSnapshot({ ...base, extra: true })).toBe(false);
    });
    it("does not invoke getters or serialization hooks", () => {
        const getter = vi.fn(() => "secret");
        const hook = vi.fn(() => "secret");
        for (const value of [
            Object.defineProperty(entry(), "payload", { enumerable: true, get: getter }),
            {
                ...entry(),
                payload: {
                    get secret() {
                        return getter();
                    },
                },
            },
            { ...entry(), payload: { toJSON: hook } },
        ])
            expect(isControlMessageDebugEntry(value)).toBe(false);
        const entries = Object.defineProperty([entry()], "0", { enumerable: true, get: getter });
        expect(isControlMessageDebugSnapshot({ ...snapshot(), entries })).toBe(false);
        expect(getter).not.toHaveBeenCalled();
        expect(hook).not.toHaveBeenCalled();
    });
    it("accepts only bounded clear receipts", () => {
        const value = { gatewayInstanceId: randomUUID(), clearedCount: 2, clearedThroughSeq: 9 };
        expect(isControlMessageDebugClearReceipt(value)).toBe(true);
        for (const patch of [
            { clearedCount: 301 },
            { clearedCount: 10 },
            { clearedCount: -1 },
            { clearedThroughSeq: 1.5 },
            { extra: true },
            { gatewayInstanceId: "bad" },
        ])
            expect(isControlMessageDebugClearReceipt({ ...value, ...patch })).toBe(false);
    });
    it("binds clear to the expected instance and rejects a different instance without replay", async () => {
        const id = randomUUID();
        const result = { gatewayInstanceId: id, clearedCount: 1, clearedThroughSeq: 9 };
        const request = vi.fn<ControlTransport["request"]>().mockResolvedValue(result);
        const client = new ControlClient({ request });
        expect(await client.clearMessageDebug(id)).toEqual(result);
        expect(request).toHaveBeenCalledExactlyOnceWith(
            "POST",
            "/api/control/message-debug/clear",
            {
                expectedGatewayInstanceId: id,
            },
        );
        request.mockClear().mockResolvedValue({ ...result, gatewayInstanceId: randomUUID() });
        await expect(client.clearMessageDebug(id)).rejects.toThrow("结果未确认");
        expect(request).toHaveBeenCalledTimes(1);
        request.mockClear().mockRejectedValue(new Error("connection lost"));
        await expect(client.clearMessageDebug(id)).rejects.toThrow("connection lost");
        expect(request).toHaveBeenCalledTimes(1);
        request.mockClear();
        await expect(client.clearMessageDebug("invalid")).rejects.toThrow("标识无效");
        expect(request).not.toHaveBeenCalled();
    });
    it("rejects malformed history at the shared client boundary", async () => {
        const request = vi.fn<ControlTransport["request"]>().mockResolvedValue({ entries: [] });
        await expect(new ControlClient({ request }).messageDebugHistory()).rejects.toThrow(
            "响应无效",
        );
        expect(request).toHaveBeenCalledTimes(1);
    });
});
