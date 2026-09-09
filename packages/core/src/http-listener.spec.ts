import { createServer } from "node:http";
import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { listenHttpServer } from "./http-listener.js";

it("提前取消不会打开端口", async () => {
    const server = createServer();
    const initialListening = server.listeners("listening");
    const controller = new AbortController();
    controller.abort();
    await expect(listenHttpServer(server, { port: 0 }, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
    });
    expect(server.listening).toBe(false);
    expect(server.listeners("listening")).toEqual(initialListening);
});

it("地址绑定过程中取消，不留下迟到的监听服务", async () => {
    const server = createServer();
    const initialListening = server.listeners("listening");
    const controller = new AbortController();
    const started = listenHttpServer(server, { host: "127.0.0.1", port: 0 }, controller.signal);
    controller.abort();
    await expect(started).rejects.toMatchObject({ name: "AbortError" });
    await setImmediate();
    expect(server.listening).toBe(false);
    expect(server.address()).toBeNull();
    expect(server.listeners("listening")).toEqual(initialListening);
    expect(server.listenerCount("error")).toBe(0);
});

it("监听成功后取消同一启动信号仍关闭服务", async () => {
    const server = createServer();
    const controller = new AbortController();
    try {
        await listenHttpServer(server, { host: "127.0.0.1", port: 0 }, controller.signal);
        expect(server.listening).toBe(true);
        controller.abort();
        await setImmediate();
        expect(server.listening).toBe(false);
    } finally {
        server.close();
    }
});

it("绑定失败传播实际错误并移除临时监听器", async () => {
    const occupied = createServer();
    const server = createServer();
    const initialListening = server.listeners("listening");
    try {
        await listenHttpServer(occupied, { host: "127.0.0.1", port: 0 });
        const address = occupied.address();
        if (!address || typeof address === "string") throw new Error("监听地址缺失");
        await expect(
            listenHttpServer(server, { host: "127.0.0.1", port: address.port }),
        ).rejects.toMatchObject({ code: "EADDRINUSE" });
        expect(server.listenerCount("error")).toBe(0);
        expect(server.listeners("listening")).toEqual(initialListening);
    } finally {
        occupied.close();
        server.close();
    }
});
