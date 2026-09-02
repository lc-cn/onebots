import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { describe, expect, test, vi } from "vitest";
import type { OneBotV11Config } from "../config.js";
import { OneBotV11Transport } from "../transport.js";

describe("OneBot V11 transport lifecycle", () => {
    test("registers universal and split-role WebSocket routes", async () => {
        const emitter = new EventEmitter();
        const servers = new Map<string, EventEmitter>();
        const apply = vi.fn().mockResolvedValue({ status: "ok", retcode: 0, data: {} });
        const router = {
            ws: vi.fn((path: string) => {
                const server = new EventEmitter();
                servers.set(path, server);
                return server;
            }),
        };
        const transport = new OneBotV11Transport({
            accountId: "bot",
            path: "/mock/bot/onebot/v11",
            config: {
                protocol: "onebot",
                version: "v11",
                use_http: false,
                use_ws: true,
                http_reverse: [],
                ws_reverse: [],
            } as OneBotV11Config.Config,
            router: router as never,
            logger: {
                debug: vi.fn(),
                error: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
            },
            apply,
            format: (_event, payload) => payload,
            onDispatch: listener => emitter.on("dispatch", listener),
            offDispatch: listener => emitter.off("dispatch", listener),
            dispatchEmitter: emitter,
        });

        transport.start();
        expect([...servers.keys()]).toEqual([
            "/mock/bot/onebot/v11",
            "/mock/bot/onebot/v11/event",
            "/mock/bot/onebot/v11/api",
            "/mock/bot/onebot/v11//event",
            "/mock/bot/onebot/v11//api",
        ]);

        const eventSocket = createSocket();
        const apiSocket = createSocket();
        servers
            .get("/mock/bot/onebot/v11/event")!
            .emit("connection", eventSocket, { url: "/mock/bot/onebot/v11/event", headers: {} });
        servers
            .get("/mock/bot/onebot/v11/api")!
            .emit("connection", apiSocket, { url: "/mock/bot/onebot/v11/api", headers: {} });

        emitter.emit("dispatch", JSON.stringify({ post_type: "message" }));
        eventSocket.emit("message", Buffer.from(JSON.stringify({ action: "ignored" })));
        apiSocket.emit(
            "message",
            Buffer.from(JSON.stringify({ action: "get_login_info", echo: "api-1" })),
        );
        await new Promise(resolve => setImmediate(resolve));

        expect(eventSocket.send).toHaveBeenCalledTimes(2);
        expect(apiSocket.send).toHaveBeenCalledOnce();
        expect(JSON.parse(String(apiSocket.send.mock.calls[0][0]))).toMatchObject({
            status: "ok",
            echo: "api-1",
        });
        expect(apply).toHaveBeenCalledOnce();
        transport.stop();
    });

    test("stop removes every HTTP reverse dispatch listener", () => {
        const emitter = new EventEmitter();
        const transport = new OneBotV11Transport({
            accountId: "bot",
            path: "/mock/bot/onebot/v11",
            config: {
                protocol: "onebot",
                version: "v11",
                use_http: false,
                use_ws: false,
                http_reverse: ["https://example.com/a", "https://example.com/b"],
                ws_reverse: [],
            } as OneBotV11Config.Config,
            router: {} as never,
            logger: {
                debug: vi.fn(),
                error: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
            },
            apply: vi.fn(),
            format: vi.fn(),
            onDispatch: listener => emitter.on("dispatch", listener),
            offDispatch: listener => emitter.off("dispatch", listener),
            dispatchEmitter: emitter,
        });

        transport.start();
        expect(emitter.listenerCount("dispatch")).toBe(2);

        transport.stop();
        expect(emitter.listenerCount("dispatch")).toBe(0);
    });
});

function createSocket() {
    const socket = new EventEmitter() as EventEmitter & {
        readyState: number;
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
    };
    socket.readyState = WebSocket.OPEN;
    socket.send = vi.fn();
    socket.close = vi.fn();
    return socket;
}
