import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GatewayMessageDebugStore } from "./message-debug-store.js";
import { handleGatewayMessageDebug } from "./message-debug-ipc.js";
import {
    isGatewayMessageDebugReply,
    isGatewayMessageDebugRequest,
} from "./message-debug-contracts.js";

const identity = {
    protocolVersion: 1 as const,
    controlInstanceId: randomUUID(),
    gatewayInstanceId: randomUUID(),
};
const request = (action: "history" | "clear" = "history") => ({
    ...identity,
    type: "gateway.message-debug" as const,
    requestId: randomUUID(),
    action,
});
describe("gateway message debug IPC", () => {
    it("returns bounded history and a clear watermark without resetting sequence", () => {
        const store = new GatewayMessageDebugStore();
        const send = vi.fn();
        store.recordInbound("mock", "account", { text: "one" });
        const history = request();
        expect(handleGatewayMessageDebug(history, identity, store, send)).toBe(true);
        expect(send.mock.calls[0][0]).toMatchObject({
            requestId: history.requestId,
            outcome: "succeeded",
            result: { entries: [{ seq: 1 }] },
        });
        handleGatewayMessageDebug(request("clear"), identity, store, send);
        expect(send.mock.calls[1][0]).toMatchObject({
            action: "clear",
            outcome: "succeeded",
            result: { clearedCount: 1, clearedThroughSeq: 1 },
        });
        store.recordInbound("mock", "account", "two");
        handleGatewayMessageDebug(request(), identity, store, send);
        expect(send.mock.calls[2][0].result.entries[0].seq).toBe(2);
        expect(send.mock.calls.every(([reply]) => isGatewayMessageDebugReply(reply))).toBe(true);
    });
    it("rejects not-ready requests without a result", () => {
        const send = vi.fn();
        handleGatewayMessageDebug(request("clear"), identity, undefined, send);
        expect(send.mock.calls[0][0]).toMatchObject({ outcome: "rejected", action: "clear" });
        expect(send.mock.calls[0][0]).not.toHaveProperty("result");
    });
    it("ignores forged identities and malformed frames without touching the store", () => {
        const store = new GatewayMessageDebugStore();
        const clear = vi.spyOn(store, "clear");
        const send = vi.fn();
        for (const input of [
            { ...request("clear"), gatewayInstanceId: randomUUID() },
            { ...request("clear"), controlInstanceId: randomUUID() },
            { ...request("clear"), protocolVersion: 2 },
            { ...request("clear"), extra: true },
            { ...request("clear"), requestId: "x".repeat(5000) },
        ])
            expect(handleGatewayMessageDebug(input, identity, store, send)).toBe(true);
        expect(clear).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });
    it("does not invoke accessors in requests or nested response payloads", () => {
        const getter = vi.fn(() => "gateway.message-debug");
        const input = Object.defineProperty(request(), "type", { get: getter });
        expect(isGatewayMessageDebugRequest(input)).toBe(false);
        expect(handleGatewayMessageDebug(input, identity, undefined, vi.fn())).toBe(false);
        const payload = Object.defineProperty({}, "secret", { get: getter, enumerable: true });
        const entry = {
            seq: 1,
            time: 0,
            direction: "inbound",
            platform: "mock",
            account_id: "a",
            payload,
        };
        const reply = {
            ...request(),
            type: "gateway.message-debug.result",
            outcome: "succeeded",
            result: { entries: [entry] },
        };
        expect(isGatewayMessageDebugReply(reply)).toBe(false);
        expect(getter).not.toHaveBeenCalled();
    });
    it("rejects excessive entries, entry bytes, duplicate sequence and invalid receipts", () => {
        const entry = {
            seq: 1,
            time: 0,
            direction: "inbound",
            platform: "mock",
            account_id: "a",
            payload: "ok",
        };
        const base = { ...request(), type: "gateway.message-debug.result", outcome: "succeeded" };
        expect(
            isGatewayMessageDebugReply({
                ...base,
                result: {
                    entries: Array.from({ length: 301 }, (_, i) => ({ ...entry, seq: i + 1 })),
                },
            }),
        ).toBe(false);
        expect(
            isGatewayMessageDebugReply({
                ...base,
                result: { entries: [{ ...entry, payload: "x".repeat(16384) }] },
            }),
        ).toBe(false);
        expect(isGatewayMessageDebugReply({ ...base, result: { entries: [entry, entry] } })).toBe(
            false,
        );
        expect(
            isGatewayMessageDebugReply({
                ...base,
                action: "clear",
                result: { clearedCount: -1, clearedThroughSeq: 1 },
            }),
        ).toBe(false);
    });
    it("leaves a started clear unknown when it throws", () => {
        const store = new GatewayMessageDebugStore();
        const clear = vi.spyOn(store, "clear").mockImplementation(() => {
            throw new Error("unconfirmed");
        });
        const send = vi.fn();
        handleGatewayMessageDebug(request("clear"), identity, store, send);
        expect(clear).toHaveBeenCalledTimes(1);
        expect(send).not.toHaveBeenCalled();
    });
    it("does not retry a clear when transport delivery fails", () => {
        const store = new GatewayMessageDebugStore();
        const clear = vi.spyOn(store, "clear");
        const send = vi.fn(() => {
            throw new Error("closed");
        });
        handleGatewayMessageDebug(request("clear"), identity, store, send);
        expect(clear).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(1);
    });
});
