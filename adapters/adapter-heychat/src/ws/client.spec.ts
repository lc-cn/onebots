import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { calculateHeychatReconnectDelay, HeychatWsClient } from "./client.js";

describe("calculateHeychatReconnectDelay", () => {
    it("执行封顶的指数退避并支持稳定抖动", () => {
        const middle = (): number => 0.5;
        expect(calculateHeychatReconnectDelay(1, 1_000, 30_000, middle)).toBe(1_000);
        expect(calculateHeychatReconnectDelay(4, 1_000, 30_000, middle)).toBe(8_000);
        expect(calculateHeychatReconnectDelay(20, 1_000, 30_000, middle)).toBe(30_000);
    });
});

it("新连接代次重置 sequence，避免服务端重启后永久丢事件", () => {
    const client = new HeychatWsClient({ account_id: "bot", token: "token" });
    const internal = client as unknown as {
        lastSequence: number;
        generation: number;
        attachSocket(socket: WebSocket, generation: number): void;
    };
    internal.lastSequence = 99;
    internal.generation = 1;
    internal.attachSocket(new EventEmitter() as unknown as WebSocket, 1);
    expect(internal.lastSequence).toBe(0);
    client.close();
});
