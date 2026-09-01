import { describe, expect, it, vi } from "vitest";
import {
    EventStreamEventTooLargeError,
    openAuthenticatedEventStream,
} from "./authenticated-event-stream.js";

const encoder = new TextEncoder();

function eventStream(chunks: string[]): Response {
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
                controller.close();
            },
        }),
        { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
    );
}

describe("authenticated management event stream", () => {
    it("使用无令牌 URL 和可取消请求解析跨分块、多行及心跳事件", async () => {
        const messages: string[] = [];
        let connection!: { close(): void };
        const complete = new Promise<void>(resolve => {
            connection = openAuthenticatedEventStream(
                "/api/logs",
                {
                    onMessage(data) {
                        messages.push(data);
                        if (messages.length === 2) {
                            connection.close();
                            resolve();
                        }
                    },
                    retryMs: 1,
                },
                async (url, init) => {
                    expect(url).toBe("/api/logs");
                    expect(init?.headers).toEqual({ Accept: "text/event-stream" });
                    expect(init?.signal).toBeInstanceOf(AbortSignal);
                    return eventStream([
                        "data: first",
                        " line\r",
                        "\n",
                        "data: second line\r\n\r\n: heartbeat\n\n",
                        "data: next\n\n",
                    ]);
                },
            );
        });

        await complete;
        expect(messages).toEqual(["first line\nsecond line", "next"]);
    });

    it("失败后重连，显式关闭会停止后续重试", async () => {
        const onError = vi.fn();
        const fetcher = vi
            .fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(eventStream(["data: recovered\n\n"]));
        let connection!: { close(): void };
        await new Promise<void>(resolve => {
            connection = openAuthenticatedEventStream(
                "/api/verification/stream",
                {
                    onMessage() {
                        connection.close();
                        resolve();
                    },
                    onError,
                    retryMs: 1,
                },
                fetcher,
            );
        });

        await new Promise(resolve => setTimeout(resolve, 5));
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it("响应类型无效时先取消未读取正文", async () => {
        const cancelled = vi.fn();
        let connection!: { close(): void };
        await new Promise<void>(resolve => {
            connection = openAuthenticatedEventStream(
                "/api/logs",
                {
                    onMessage: vi.fn(),
                    onError() {
                        connection.close();
                        resolve();
                    },
                },
                async () =>
                    new Response(
                        new ReadableStream<Uint8Array>({
                            cancel: cancelled,
                        }),
                        { headers: { "Content-Type": "application/json" } },
                    ),
            );
        });

        expect(cancelled).toHaveBeenCalledOnce();
    });

    it("允许同一网络分块承载多个分别位于上限内的事件", async () => {
        const messages: string[] = [];
        let connection!: { close(): void };
        await new Promise<void>(resolve => {
            connection = openAuthenticatedEventStream(
                "/api/logs",
                {
                    maxEventBytes: 9,
                    onMessage(data) {
                        messages.push(data);
                        if (messages.length === 3) {
                            connection.close();
                            resolve();
                        }
                    },
                },
                async () => eventStream(["data: a\n\ndata: b\n\ndata: c\n\n"]),
            );
        });

        expect(messages).toEqual(["a", "b", "c"]);
    });

    it("按解码前 UTF-8 字节计算跨分块事件大小", async () => {
        const messages: string[] = [];
        let connection!: { close(): void };
        await new Promise<void>(resolve => {
            connection = openAuthenticatedEventStream(
                "/api/verification/stream",
                {
                    maxEventBytes: 16,
                    onMessage(data) {
                        messages.push(data);
                        connection.close();
                        resolve();
                    },
                },
                async () => eventStream(["data: 你", "好\r", "\n\r\n"]),
            );
        });

        expect(messages).toEqual(["你好"]);
    });

    it("超限时取消流、报告一次错误且不重连", async () => {
        const cancelled = vi.fn();
        const fetcher = vi.fn(
            async () =>
                new Response(
                    new ReadableStream<Uint8Array>({
                        start(controller) {
                            controller.enqueue(encoder.encode("data: payload-too-large"));
                        },
                        cancel: cancelled,
                    }),
                    { headers: { "Content-Type": "text/event-stream" } },
                ),
        );
        const onError = vi.fn();
        await new Promise<void>(resolve => {
            openAuthenticatedEventStream(
                "/api/message-debug/stream",
                {
                    maxEventBytes: 16,
                    onMessage: vi.fn(),
                    onError(error) {
                        onError(error);
                        resolve();
                    },
                    retryMs: 1,
                },
                fetcher,
            );
        });

        await new Promise(resolve => setTimeout(resolve, 5));
        expect(onError).toHaveBeenCalledWith(expect.any(EventStreamEventTooLargeError));
        expect(cancelled).toHaveBeenCalledOnce();
        expect(fetcher).toHaveBeenCalledOnce();
    });

    it("在发起请求前拒绝无效的事件上限", () => {
        expect(() =>
            openAuthenticatedEventStream("/api/logs", {
                maxEventBytes: 0,
                onMessage: vi.fn(),
            }),
        ).toThrow("事件流单事件上限必须是 1 到 1 MiB 之间的安全整数");

        expect(() =>
            openAuthenticatedEventStream("/api/logs", {
                maxEventBytes: 1024 * 1024 + 1,
                onMessage: vi.fn(),
            }),
        ).toThrow("事件流单事件上限必须是 1 到 1 MiB 之间的安全整数");
    });
});
