import { describe, expect, it, vi } from "vitest";
import { openAuthenticatedEventStream } from "./authenticated-event-stream.js";

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
});
