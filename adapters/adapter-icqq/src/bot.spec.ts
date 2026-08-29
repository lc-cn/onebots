import { EventEmitter } from "node:events";
import type { Client, createClient } from "@icqqjs/icqq";
import { describe, expect, it, vi } from "vitest";
import { ICQQBot } from "./bot.js";

class FakeClient extends EventEmitter {
    uin = 123456;
    nickname = "bot";
    login = vi.fn<() => void | Promise<void>>();
    logout = vi.fn(async () => undefined);
    sendSsoHeartBeat = vi.fn(() => true);
    startSsoHeartBeat = vi.fn();
}

function factoryFor(...clients: FakeClient[]): typeof createClient {
    const queue = [...clients];
    return vi.fn(() => queue.shift() as unknown as Client) as unknown as typeof createClient;
}

describe("ICQQBot 生命周期", () => {
    it("并发 start 只创建一个客户端，stop 后旧事件不能复活状态", async () => {
        const client = new FakeClient();
        const nativeHeartbeat = client.sendSsoHeartBeat;
        const factory = factoryFor(client);
        const bot = new ICQQBot({ account_id: "123456" }, { createClient: factory });
        const ready = vi.fn();
        bot.on("ready", ready);

        await Promise.all([bot.start(), bot.start()]);
        expect(factory).toHaveBeenCalledTimes(1);
        client.emit("system.online");
        expect(bot.isReady()).toBe(true);
        expect(ready).toHaveBeenCalledTimes(1);

        await bot.stop();
        client.emit("system.online");
        expect(bot.isReady()).toBe(false);
        expect(ready).toHaveBeenCalledTimes(1);
        client.sendSsoHeartBeat();
        expect(nativeHeartbeat).not.toHaveBeenCalled();
    });

    it("快速重启时仅接受新 generation 的事件", async () => {
        const first = new FakeClient();
        const second = new FakeClient();
        const factory = factoryFor(first, second);
        const bot = new ICQQBot({ account_id: "123456" }, { createClient: factory });
        const ready = vi.fn();
        bot.on("ready", ready);

        await bot.start();
        await bot.stop();
        await bot.start();
        first.emit("system.online");
        expect(bot.isReady()).toBe(false);
        second.emit("system.online");
        expect(bot.isReady()).toBe(true);
        expect(ready).toHaveBeenCalledTimes(1);
    });

    it("停止后忽略旧登录 Promise 的迟到拒绝", async () => {
        let rejectLogin: (error: Error) => void = () => undefined;
        const client = new FakeClient();
        client.login.mockReturnValue(
            new Promise<void>((_resolve, reject) => {
                rejectLogin = reject;
            }),
        );
        const bot = new ICQQBot({ account_id: "123456" }, { createClient: factoryFor(client) });
        const loginError = vi.fn();
        bot.on("login_error", loginError);

        await bot.start();
        await bot.stop();
        rejectLogin(new Error("late"));
        await Promise.resolve();
        expect(loginError).not.toHaveBeenCalled();
    });

    it("登出失败仍清理客户端并报告错误", async () => {
        const client = new FakeClient();
        client.logout.mockRejectedValue(new Error("logout failed"));
        const bot = new ICQQBot({ account_id: "123456" }, { createClient: factoryFor(client) });
        const stopError = vi.fn();
        bot.on("stop_error", stopError);

        await bot.start();
        await expect(bot.stop()).resolves.toBeUndefined();
        expect(bot.getClient()).toBeNull();
        expect(stopError).toHaveBeenCalledOnce();
    });
});
