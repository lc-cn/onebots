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
    fl = new Map();
    classes = new Map();
    gl = new Map();
    reloadFriendList = vi.fn(async () => undefined);
    reloadGroupList = vi.fn(async () => undefined);
    getGroupInfo = vi.fn();
    getGroupMemberList = vi.fn(async () => new Map());
    getGroupMemberInfo = vi.fn();
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
        expect(stopError).toHaveBeenCalledWith(
            expect.objectContaining({ code: "ICQQ_STOP_FAILED", operation: "stop" }),
        );
    });

    it("未连接调用 API 时返回结构化错误", async () => {
        const bot = new ICQQBot({ account_id: "123456" });
        await expect(bot.sendPrivateMessage(10001, "hello")).rejects.toMatchObject({
            code: "ICQQ_NOT_CONNECTED",
            operation: "sendPrivateMessage",
        });
    });

    it("标准化离线事件并为心跳失败保留错误代码", async () => {
        const client = new FakeClient();
        client.sendSsoHeartBeat.mockImplementation(() => {
            throw new Error("heartbeat failed");
        });
        const bot = new ICQQBot({ account_id: "123456" }, { createClient: factoryFor(client) });
        const offline = vi.fn();
        const heartbeatError = vi.fn();
        bot.on("offline", offline);
        bot.on("heartbeat_error", heartbeatError);
        await bot.start();

        client.emit("system.offline.kickoff", { message: "kicked" });
        expect(offline).toHaveBeenCalledWith({ uin: 123456, message: "kicked" });
        expect(client.sendSsoHeartBeat()).toBe(false);
        expect(heartbeatError).toHaveBeenCalledWith(
            expect.objectContaining({ code: "ICQQ_HEARTBEAT_FAILED" }),
        );
    });

    it("隔离上层事件监听器异常", async () => {
        const client = new FakeClient();
        const bot = new ICQQBot({ account_id: "123456" }, { createClient: factoryFor(client) });
        const clientError = vi.fn();
        bot.on("client_error", clientError);
        bot.on("ready", () => {
            throw new Error("listener failed");
        });
        await bot.start();

        expect(() => client.emit("system.online")).not.toThrow();
        expect(clientError).toHaveBeenCalledWith(
            expect.objectContaining({ code: "ICQQ_LISTENER_FAILED", operation: "ready" }),
        );
    });

    it("将目录刷新意图传递给 ICQQ 原生客户端", async () => {
        const client = new FakeClient();
        client.getGroupInfo.mockResolvedValue({
            group_id: 20001,
            group_name: "OneBots",
            owner_id: 10001,
            member_count: 2,
            max_member_count: 500,
            create_time: 100,
        });
        const bot = new ICQQBot({ account_id: "123456" }, { createClient: factoryFor(client) });
        await bot.start();

        await bot.getFriendList(true);
        await bot.getFriendInfo(10001, true);
        await bot.getGroupList(true);
        await bot.getGroupInfo(20001, true);
        await bot.getGroupMemberList(20001, true);
        await bot.getGroupMemberInfo(20001, 10001, true);

        expect(client.reloadFriendList).toHaveBeenCalledTimes(2);
        expect(client.reloadGroupList).toHaveBeenCalledOnce();
        expect(client.getGroupInfo).toHaveBeenCalledWith(20001, true);
        expect(client.getGroupMemberList).toHaveBeenCalledWith(20001, true);
        expect(client.getGroupMemberInfo).toHaveBeenCalledWith(20001, 10001, true);
    });
});
