import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { GatewayMessageDebugStore } from "./message-debug-store.js";
import { isGatewayMessageDebugEntry } from "./message-debug-contracts.js";

describe("GatewayMessageDebugStore", () => {
    it("过深但可序列化的消息降级后仍符合传输契约", () => {
        const store = new GatewayMessageDebugStore();
        let payload: unknown = "leaf";
        for (let depth = 0; depth < 70; depth++) payload = { child: payload };
        store.recordInbound("mock", "1", payload);
        store.recordInbound("mock", "1", { text: "next" });
        const entries = store.getHistory();
        expect(entries[0].payload).toEqual({
            debugUnavailable: true,
            reason: "消息超过调试传输结构限制",
        });
        expect(entries[1]).toMatchObject({ seq: 2, payload: { text: "next" } });
        expect(entries.every(isGatewayMessageDebugEntry)).toBe(true);
    });
    it("保留最近 300 条，清空后序号水位继续递增", () => {
        const store = new GatewayMessageDebugStore();
        for (let index = 0; index < 305; index++) store.recordInbound("mock", "1", { index });
        const history = store.getHistory();
        expect(history).toHaveLength(300);
        expect(history[0].seq).toBe(6);
        expect(history[299].seq).toBe(305);
        expect(store.clear()).toEqual({ clearedCount: 300, clearedThroughSeq: 305 });
        expect(store.getHistory()).toEqual([]);
        expect(store.clear()).toEqual({ clearedCount: 0, clearedThroughSeq: 305 });
        store.recordOutbound("mock", "1", "onebot", "v11", "message");
        expect(store.getHistory()[0]).toMatchObject({
            seq: 306,
            direction: "outbound",
            platform: "mock",
            account_id: "1",
            protocol: "onebot",
            version: "v11",
            payload: "message",
        });
    });

    it("记录与读取均不共享可变业务对象", () => {
        const store = new GatewayMessageDebugStore();
        const payload = { content: { text: "original" }, items: [1] };
        store.recordInbound("mock", "1", payload);
        payload.content.text = "changed";
        payload.items.push(2);
        const history = store.getHistory();
        expect(history[0].payload).toEqual({ content: { text: "original" }, items: [1] });
        (history[0].payload as typeof payload).content.text = "reader changed";
        history[0].platform = "other";
        history.splice(0);
        expect(store.getHistory()[0]).toMatchObject({
            platform: "mock",
            payload: { content: { text: "original" }, items: [1] },
        });
    });

    it("坏数据降级为安全占位且不阻止后续记录", () => {
        const store = new GatewayMessageDebugStore();
        const circular: { self?: unknown } = {};
        circular.self = circular;
        const throwing = {
            get secret() {
                throw new Error("SECRET");
            },
        };
        const toJSON = {
            toJSON() {
                throw throwing;
            },
        };
        const payloads = [circular, 1n, throwing, toJSON, undefined, () => undefined];
        for (const payload of payloads) {
            expect(() => store.recordInbound("mock", "1", payload)).not.toThrow();
        }
        for (const entry of store.getHistory()) {
            expect(entry.payload).toEqual({
                debugUnavailable: true,
                reason: "消息无法序列化为 JSON",
            });
        }
        expect(JSON.stringify(store.getHistory())).not.toContain("SECRET");
        store.recordInbound("mock", "1", null);
        expect(store.getHistory().at(-1)).toMatchObject({ seq: 7, payload: null });
    });

    it("按完整 JSON 的 UTF-8 字节数限制记录，包括超长标识", () => {
        const store = new GatewayMessageDebugStore();
        store.recordInbound("mock", "1", "中".repeat(6000));
        store.recordOutbound(
            "\u0000".repeat(20000),
            "中".repeat(20000),
            "p".repeat(20000),
            "v".repeat(20000),
            {},
        );
        for (const entry of store.getHistory()) {
            expect(Buffer.byteLength(JSON.stringify(entry), "utf8")).toBeLessThanOrEqual(16 * 1024);
            expect(entry.payload).toEqual({
                debugUnavailable: true,
                reason: "消息超过 16 KiB 调试记录上限",
            });
        }
        store.recordInbound("mock", "1", "x".repeat(15000));
        expect(store.getHistory().at(-1)?.payload).toBe("x".repeat(15000));
    });
});
