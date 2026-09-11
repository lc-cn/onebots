import { describe, expect, it, vi } from "vitest";
import {
    ControlLogClient,
    isControlLogBatch,
    isControlLogSnapshot,
    sanitizeLogText,
} from "./control-logs.js";
import { createHttpControlTransport } from "./control.js";
const snapshot = { source: "gateway", text: "hello", truncated: false, exists: true };
describe("control logs", () => {
    it("accepts only the fixed bounded snapshot without getters or extra keys", () => {
        expect(isControlLogSnapshot(snapshot)).toBe(true);
        for (const value of [
            null,
            [],
            { ...snapshot, path: "/tmp/secret" },
            { ...snapshot, source: "manager" },
            { ...snapshot, exists: false },
            { ...snapshot, text: "a".repeat(65537) },
        ])
            expect(isControlLogSnapshot(value)).toBe(false);
        const getter = vi.fn();
        expect(
            isControlLogSnapshot({
                ...snapshot,
                get text() {
                    return getter();
                },
            }),
        ).toBe(false);
        expect(getter).not.toHaveBeenCalled();
        expect(isControlLogSnapshot({ ...snapshot, text: "a".repeat(65536) })).toBe(true);
        expect(isControlLogSnapshot({ ...snapshot, text: "�".repeat(65536) })).toBe(true);
        expect(isControlLogSnapshot({ ...snapshot, text: "", exists: false })).toBe(true);
    });
    it("removes CSI, OSC hyperlinks/clipboard, DCS, C1, and bidi commands but retains newlines/tabs", () => {
        expect(
            sanitizeLogText(
                "\x1b[31mred\x1b[0m\n\tOK\x1b]52;c;secret\x07\x1bPsecret\x1b\\\x9b2J\u202e\r",
            ),
        ).toBe("red\n\tOK");
        expect(sanitizeLogText("\x1b]8;;https://bad\x1b\\link\x1b]8;;\x1b\\")).toBe("link");
        expect(sanitizeLogText("before\x1b]52;unfinished")).toBe("before");
    });
    it("does not read automatically and only calls the fixed route once", async () => {
        const request = vi.fn().mockResolvedValue({ ...snapshot, text: "\x1b[2Jhello" });
        const client = new ControlLogClient({ request });
        expect(request).not.toHaveBeenCalled();
        expect((await client.gateway()).text).toBe("hello");
        expect(request.mock.calls).toEqual([["GET", "/api/control/logs/gateway"]]);
    });
    it("queries all fixed sources with an opaque follow cursor", async () => {
        const batch = {
            schemaVersion: 1 as const,
            source: "operation" as const,
            text: "\x1b[2Jdone",
            cursor: "0123456789abcdef.42",
            truncated: false,
            exists: true,
            reset: false,
        };
        const request = vi.fn().mockResolvedValue(batch);
        const client = new ControlLogClient({ request });
        expect(await client.query({ source: "operation" })).toEqual({ ...batch, text: "done" });
        await client.query({ source: "operation", cursor: batch.cursor });
        expect(request.mock.calls).toEqual([
            ["GET", "/api/control/logs?source=operation"],
            ["GET", "/api/control/logs?source=operation&cursor=0123456789abcdef.42"],
        ]);
        expect(isControlLogBatch(batch)).toBe(true);
        expect(isControlLogBatch({ ...batch, source: "secret" })).toBe(false);
        expect(isControlLogBatch({ ...batch, path: "/tmp/secret" })).toBe(false);
        expect(isControlLogBatch({ ...batch, text: "中".repeat(22_000) })).toBe(false);
        expect(isControlLogBatch({ ...batch, cursor: "0123456789abcdef.9007199254740991" })).toBe(
            true,
        );
        expect(isControlLogBatch({ ...batch, cursor: "0123456789abcdef.9999999999999999" })).toBe(
            false,
        );
        await expect(
            client.query({ source: "operation", cursor: "0123456789abcdef.10000000000000000" }),
        ).rejects.toThrow("查询参数无效");
        await expect(client.query({ source: "secret" as "gateway" })).rejects.toThrow(
            "查询参数无效",
        );
        expect(request).toHaveBeenCalledTimes(2);
    });
    it("does not leak transport or malformed response details", async () => {
        const request = vi.fn().mockRejectedValue(new Error("secret"));
        await expect(new ControlLogClient({ request }).gateway()).rejects.toThrow(
            "无法读取网关日志",
        );
        request.mockResolvedValue({ ...snapshot, text: "a".repeat(65537) });
        await expect(new ControlLogClient({ request }).gateway()).rejects.not.toThrow("secret");
        expect(request).toHaveBeenCalledTimes(2);
    });
    it("parses bounded SSE batches and cancels the underlying stream when iteration stops", async () => {
        const cancelled = vi.fn();
        const bytes = new TextEncoder().encode(
            'event: logs\ndata: {"schemaVersion":1,"source":"manager","text":"\\u001b[31mready","cursor":"0123456789abcdef.5","truncated":false,"exists":true,"reset":false}\n\n',
        );
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes.subarray(0, 17));
                controller.enqueue(bytes.subarray(17));
            },
            cancel: cancelled,
        });
        let streamSignal: AbortSignal | undefined;
        const stream = vi.fn(async (_route: string, signal: AbortSignal) => {
            streamSignal = signal;
            return body;
        });
        const client = new ControlLogClient({ request: vi.fn(), stream });
        const subscription = client.stream({ source: "manager" });
        expect(await subscription.next()).toEqual({
            done: false,
            value: {
                schemaVersion: 1,
                source: "manager",
                text: "ready",
                cursor: "0123456789abcdef.5",
                truncated: false,
                exists: true,
                reset: false,
            },
        });
        await subscription.return();
        expect(stream).toHaveBeenCalledWith(
            "/api/control/logs/stream?source=manager",
            expect.any(AbortSignal),
        );
        expect(streamSignal?.aborted).toBe(true);
        expect(cancelled).toHaveBeenCalledTimes(1);
    });
    it("HTTP stream passes bearer authentication and caller cancellation to fetch", async () => {
        const body = new ReadableStream<Uint8Array>();
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(
                new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
            );
        const transport = createHttpControlTransport("http://localhost/", () => "session", fetcher);
        const controller = new AbortController();
        await transport.stream!("/api/control/logs/stream?source=gateway", controller.signal);
        expect(fetcher).toHaveBeenCalledWith(
            "http://localhost/api/control/logs/stream?source=gateway",
            expect.objectContaining({
                method: "GET",
                headers: { Authorization: "Bearer session" },
                signal: controller.signal,
            }),
        );
        controller.abort();
        expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    });
});
