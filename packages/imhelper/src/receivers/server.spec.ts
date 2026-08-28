import { createServer } from "node:net";
import WebSocket from "ws";
import { afterEach, describe, expect, test } from "vitest";
import { Adapter } from "../adapter.js";
import type { Receiver } from "../receiver.js";
import { WebhookReceiver } from "./webhook.js";
import { WSSReceiver } from "./wss.js";

interface RawEvent {
    value: string;
}

class TestAdapter extends Adapter<string, RawEvent> {
    readonly selfId = "bot";
    readonly events: RawEvent[] = [];
    #resolveNext?: () => void;

    transformEvent(event: RawEvent): void {
        this.events.push(event);
        this.#resolveNext?.();
        this.#resolveNext = undefined;
    }

    waitForEvent(): Promise<void> {
        return new Promise(resolve => {
            this.#resolveNext = resolve;
        });
    }
}

async function reservePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("无法分配测试端口");
    await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
    });
    return address.port;
}

describe("server receivers", () => {
    const activeReceivers: Receiver<string, RawEvent>[] = [];

    afterEach(async () => {
        await Promise.all(activeReceivers.splice(0).map(receiver => receiver.disconnect()));
    });

    test("Webhook shares ingress semantics and accepts query authentication", async () => {
        const adapter = new TestAdapter();
        const receiver = new WebhookReceiver(adapter, "/events", { accessToken: "secret" });
        activeReceivers.push(receiver);
        const port = await reservePort();
        await receiver.connect(port);

        const response = await fetch(`http://127.0.0.1:${port}/events?access_token=secret`, {
            method: "POST",
            body: JSON.stringify({ value: "webhook" }),
        });
        const unauthorized = await fetch(`http://127.0.0.1:${port}/events`, {
            method: "POST",
            body: JSON.stringify({ value: "rejected" }),
        });
        const headerPreferred = await fetch(`http://127.0.0.1:${port}/events?access_token=wrong`, {
            method: "POST",
            headers: { authorization: "Bearer secret" },
            body: JSON.stringify({ value: "header" }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: "ok" });
        expect(unauthorized.status).toBe(401);
        expect(headerPreferred.status).toBe(200);
        expect(adapter.events).toEqual([{ value: "webhook" }, { value: "header" }]);
    });

    test("reverse WebSocket reuses the same framed ingress path", async () => {
        const adapter = new TestAdapter();
        const receiver = new WSSReceiver(adapter, "/events", { accessToken: "secret" });
        activeReceivers.push(receiver);
        const port = await reservePort();
        await receiver.connect(port);

        const socket = new WebSocket(`ws://127.0.0.1:${port}/events?access_token=secret`);
        await new Promise<void>((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
        });
        const received = adapter.waitForEvent();
        socket.send(JSON.stringify({ value: "wss" }));
        await received;

        expect(adapter.events).toEqual([{ value: "wss" }]);
        socket.close();
    });
});
