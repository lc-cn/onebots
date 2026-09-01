import { once } from "node:events";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { calculateHeychatReconnectDelay, HeychatWsClient } from "./client.js";

describe("calculateHeychatReconnectDelay", () => {
    it("执行封顶的指数退避并支持稳定抖动", () => {
        const middle = (): number => 0.5;
        expect(calculateHeychatReconnectDelay(1, 1_000, 30_000, middle)).toBe(1_000);
        expect(calculateHeychatReconnectDelay(4, 1_000, 30_000, middle)).toBe(8_000);
        expect(calculateHeychatReconnectDelay(20, 1_000, 30_000, middle)).toBe(30_000);
    });
});

describe("HeychatWsClient 生命周期", () => {
    it("把启动信号传入握手并原样传播取消原因", async () => {
        const client = new HeychatWsClient({ account_id: "bot", token: "token" });
        let handshakeSignal: AbortSignal | undefined;
        vi.spyOn(
            client as unknown as {
                openSocket(generation: number, signal?: AbortSignal): Promise<never>;
            },
            "openSocket",
        ).mockImplementation(
            (_generation, signal) =>
                new Promise<never>((_resolve, reject) => {
                    handshakeSignal = signal;
                    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
                }),
        );
        const controller = new AbortController();
        const reason = new Error("account startup timeout");

        const connecting = client.connect(controller.signal);
        controller.abort(reason);

        await expect(connecting).rejects.toBe(reason);
        expect(handshakeSignal?.aborted).toBe(true);
    });

    it("关闭未完成的真实握手时让 connect 明确结算", async () => {
        const sockets = new Set<Socket>();
        const server = createServer(socket => {
            sockets.add(socket);
            socket.on("close", () => sockets.delete(socket));
        });
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address() as AddressInfo;
        const client = new HeychatWsClient({
            account_id: "bot",
            token: "token",
            ws_url: `ws://127.0.0.1:${address.port}`,
            request_timeout_ms: 5_000,
        });
        try {
            const accepted = once(server, "connection");
            const connecting = client.connect();
            await accepted;

            client.close();

            await expect(connecting).resolves.toBeUndefined();
            expect(
                client as unknown as {
                    pendingWs: unknown;
                    abortPendingConnect: unknown;
                },
            ).toMatchObject({ pendingWs: null, abortPendingConnect: null });
        } finally {
            client.close();
            for (const socket of sockets) socket.destroy();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});
