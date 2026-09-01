import { describe, expect, it, vi } from "vitest";
import {
    readBoundedJsonResponse,
    readBoundedResponseBody,
    ResponseBodyTooLargeError,
} from "./bounded-response.js";

describe("Web bounded response reader", () => {
    it("rejects an oversized declared body before reading it", async () => {
        const cancelled = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            cancel: cancelled,
        });
        const response = new Response(body, { headers: { "content-length": "1025" } });

        await expect(readBoundedResponseBody(response, 1024)).rejects.toBeInstanceOf(
            ResponseBodyTooLargeError,
        );
        expect(cancelled).toHaveBeenCalledOnce();
    });

    it("counts streamed bytes and cancels a body that crosses the limit", async () => {
        const cancelled = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(700));
                controller.enqueue(new Uint8Array(400));
            },
            cancel: cancelled,
        });

        await expect(readBoundedResponseBody(new Response(body), 1024)).rejects.toThrow(
            "响应正文超过 1 KiB 上限",
        );
        expect(cancelled).toHaveBeenCalledOnce();
    });

    it("decodes multibyte text split across chunks without counting characters as bytes", async () => {
        const bytes = new TextEncoder().encode("你好");
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes.slice(0, 2));
                controller.enqueue(bytes.slice(2));
                controller.close();
            },
        });

        await expect(readBoundedResponseBody(new Response(body), bytes.byteLength)).resolves.toBe(
            "你好",
        );
    });

    it("parses bounded JSON while leaving its contract unknown", async () => {
        await expect(
            readBoundedJsonResponse(Response.json({ application: "onebots" }), 1024),
        ).resolves.toEqual({ application: "onebots" });
    });

    it("rejects invalid limits before consuming the response", async () => {
        await expect(readBoundedResponseBody(new Response("body"), 0)).rejects.toThrow(
            "响应正文上限必须是正安全整数",
        );
    });
});
