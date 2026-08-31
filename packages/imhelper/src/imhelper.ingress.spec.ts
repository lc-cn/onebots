import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import { Adapter } from "./adapter.js";
import { createImHelper } from "./index.js";
import type { ImHelper } from "./imhelper.js";

class TestAdapter extends Adapter<string> {
    readonly selfId = "bot";
    readonly transform = vi.fn<(event: unknown) => void>();

    transformEvent(event: unknown): void {
        this.transform(event);
        (this as EventEmitter).emit("event", event);
    }
}

function createHttpRequest(
    body: string,
    method = "POST",
): Readable & {
    method: string;
    url: string;
    headers: Record<string, string>;
} {
    return Object.assign(Readable.from([body]), {
        method,
        url: "/events",
        headers: { "content-type": "application/json" },
    });
}

describe("ImHelper host-managed ingress", () => {
    function acceptsNodeHttpTypes(
        client: ImHelper<string>,
        request: IncomingMessage,
        response: ServerResponse,
    ): void {
        void client.acceptHttp(request, response);
    }

    void acceptsNodeHttpTypes;

    function acceptsWsType(client: ImHelper<string>, socket: WebSocket): void {
        client.acceptWebSocket(socket);
    }

    void acceptsWsType;

    it("ingest 将原始事件交给同一个适配器和 Client 事件流", () => {
        const adapter = new TestAdapter();
        const client = createImHelper(adapter);
        const listener = vi.fn();
        client.on("event", listener);
        const event = { post_type: "meta_event", time: 1 };

        client.ingest(event);

        expect(adapter.transform).toHaveBeenCalledWith(event);
        expect(listener).toHaveBeenCalledWith(event);
    });

    it("acceptHttp 无 response 时返回结构化响应并摄取 JSON 请求体", async () => {
        const adapter = new TestAdapter();
        const client = createImHelper(adapter);
        const event = { post_type: "message", message_id: "42" };

        const result = await client.acceptHttp(createHttpRequest(JSON.stringify(event)));

        expect(result).toEqual({
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
            body: { status: "ok" },
        });
        expect(adapter.transform).toHaveBeenCalledWith(event);
    });

    it("acceptHttp 可直接写入已有 HTTP response", async () => {
        const adapter = new TestAdapter();
        const client = createImHelper(adapter);
        const response = {
            writeHead: vi.fn(),
            end: vi.fn(),
        };

        const result = await client.acceptHttp(createHttpRequest("{invalid"), response);

        expect(result.status).toBe(400);
        expect(response.writeHead).toHaveBeenCalledWith(400, result.headers);
        expect(response.end).toHaveBeenCalledWith(JSON.stringify(result.body));
        expect(adapter.transform).not.toHaveBeenCalled();
    });

    it("acceptHttp 将适配器转换异常作为服务端摄取失败返回", async () => {
        const adapter = new TestAdapter();
        adapter.transform.mockImplementation(() => {
            throw new TypeError("协议事件字段无效");
        });
        const client = createImHelper(adapter);

        const result = await client.acceptHttp(createHttpRequest("{}"));

        expect(result.status).toBe(500);
        expect(result.body).toEqual({
            status: "error",
            message: "事件摄取失败",
        });
    });

    it("acceptHttp 支持 Web 标准 Request", async () => {
        const adapter = new TestAdapter();
        const client = createImHelper(adapter);
        const event = { type: "message", id: "fetch-request" };
        const request = new Request("http://localhost/events", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(event),
        });

        const result = await client.acceptHttp(request);

        expect(result.status).toBe(200);
        expect(adapter.transform).toHaveBeenCalledWith(event);
    });

    it("acceptHttp 拒绝超过默认上限的请求体", async () => {
        const adapter = new TestAdapter();
        const client = createImHelper(adapter);

        const result = await client.acceptHttp(createHttpRequest(`"${"x".repeat(1024 * 1024)}"`));

        expect(result.status).toBe(413);
        expect(adapter.transform).not.toHaveBeenCalled();
    });

    it("acceptWebSocket 接收已升级 socket，并可解除消息监听", () => {
        const adapter = new TestAdapter();
        const client = createImHelper(adapter);
        const socket = new EventEmitter();
        const detach = client.acceptWebSocket(socket);
        const event = { type: "message", id: "1" };

        socket.emit("message", Buffer.from(JSON.stringify(event)));
        expect(adapter.transform).toHaveBeenCalledWith(event);

        detach();
        socket.emit("message", Buffer.from(JSON.stringify({ id: "2" })));
        expect(adapter.transform).toHaveBeenCalledTimes(1);
    });

    it("acceptWebSocket 以 1009 关闭超过默认上限的消息", () => {
        const adapter = new TestAdapter();
        const client = createImHelper(adapter);
        const socket = new EventEmitter() as EventEmitter & { close: (code?: number, reason?: string) => unknown };
        socket.close = vi.fn<(code?: number, reason?: string) => unknown>();
        client.acceptWebSocket(socket);

        socket.emit("message", Buffer.alloc(1024 * 1024 + 1));

        expect(socket.close).toHaveBeenCalledWith(1009, "事件载荷过大");
        expect(adapter.transform).not.toHaveBeenCalled();
    });
});
