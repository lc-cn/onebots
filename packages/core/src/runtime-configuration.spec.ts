import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { BaseApp } from "./base-app.js";
import { Account, AccountStatus } from "./account.js";
import { Adapter } from "./adapter.js";
import { Protocol } from "./protocol.js";
import { AdapterRegistry, ProtocolRegistry } from "./registry.js";
import { runWithAdapterRouteScope } from "./scoped-adapter.js";
import { planRuntimeConfiguration } from "./runtime-configuration.js";
import { sendAccountMessage } from "./adapter-send.js";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const dispose of disposals.splice(0)) await dispose();
    AdapterRegistry.unregister("hotplug-test");
    ProtocolRegistry.unregister("hotplug-test");
});

async function fixture() {
    let sequence = 0;
    let rejectRecovery = false;
    let releaseQuery: (() => void) | undefined;
    let reportQuery: (() => void) | undefined;
    const queryEntered = new Promise<void>(resolve => {
        reportQuery = resolve;
    });
    class TestAdapter extends Adapter {
        private readonly mounted = new Set<string>();
        constructor(app: BaseApp) {
            super(app, "hotplug-test");
        }
        createAccount(config: Account.Config): Account {
            const identity = ++sequence;
            const account = new Account(this, { identity }, config);
            const path = `${account.path}/callback`;
            // 模拟共享平台 Host：只挂载一次，请求动态解析当前账号。
            runWithAdapterRouteScope(this, () => {
                if (this.mounted.has(path)) return;
                this.app.router.get(path, ctx => {
                    const current = this.accounts.get(config.account_id);
                    ctx.status = current ? 200 : 404;
                    ctx.body = current ? current.client : { error: "账号不存在" };
                });
                this.mounted.add(path);
            });
            account.on("start", () => {
                if (config.fail) throw new Error("平台启动失败");
                account.status = AccountStatus.Online;
            });
            account.on("stop", () => {
                account.status = AccountStatus.OffLine;
            });
            return account;
        }
        async getGroupList(): Promise<Adapter.GroupInfo[]> {
            reportQuery?.();
            await new Promise<void>(resolve => {
                releaseQuery = resolve;
            });
            return [];
        }
        async sendMessage(uin: string): Promise<Adapter.SendMessageResult> {
            const client = this.accounts.get(uin)?.client;
            const identity =
                client && typeof client === "object" && "identity" in client
                    ? String(client.identity)
                    : "missing";
            return { message_id: this.createId(identity) };
        }
    }
    for (const version of ["v1", "v2"]) {
        class TestProtocol extends Protocol {
            readonly name = "hotplug-test";
            readonly version = version;
            constructor(adapter: Adapter, account: Account, config: Record<string, unknown>) {
                super(adapter, account, { ...config, protocol: "hotplug-test", version });
            }
            start(): void {
                this.router.get(this.path, ctx => {
                    ctx.body = { label: this.config.label };
                });
                this.router.get(`${this.path}/query`, async ctx => {
                    ctx.body = await this.apply("query");
                });
                this.router.ws(this.path).on("connection", socket => {
                    socket.on("message", data => socket.send(data));
                });
                if (this.config.failRecovery) {
                    rejectRecovery = true;
                    throw new Error("协议替换与恢复失败");
                }
                if (rejectRecovery && this.account.account_id === "a" && this.version === "v1")
                    throw new Error("恢复连接失败");
                if (this.config.fail) throw new Error("协议启动失败");
            }
            stop(): void {
                this.removeAllListeners();
            }
            dispatch(): void {}
            format(): unknown {
                return {};
            }
            async apply(action: string): Promise<unknown> {
                if (action !== "query") return {};
                await this.account.getGroupList();
                const sent = await sendAccountMessage(this.adapter, this.account.account_id, {
                    scene_type: "private",
                    scene_id: this.adapter.createId("friend"),
                    message: [{ type: "text", data: { text: "test" } }],
                });
                return { sentBy: sent.message_id.string };
            }
        }
        ProtocolRegistry.register("hotplug-test", version, TestProtocol);
    }
    AdapterRegistry.register("hotplug-test", TestAdapter);
    const previousDirectory = BaseApp.configDir;
    const directory = mkdtempSync(join(tmpdir(), "onebots-hotplug-"));
    BaseApp.configDir = directory;
    const initial: BaseApp.Config = {
        port: 6727,
        "hotplug-test.a": {
            token: "a",
            "hotplug-test.v1": { label: "old" },
            "hotplug-test.v2": { label: "other" },
        },
        "hotplug-test.b": { token: "b", "hotplug-test.v1": { label: "unaffected" } },
    };
    const app = new BaseApp(initial);
    BaseApp.configDir = previousDirectory;
    const oldPort = process.env.PORT;
    process.env.PORT = "0";
    try {
        await app.start();
    } finally {
        if (oldPort === undefined) delete process.env.PORT;
        else process.env.PORT = oldPort;
    }
    const address = app.httpServer.address();
    if (!address || typeof address === "string") throw new Error("监听失败");
    const base = `http://127.0.0.1:${address.port}`;
    const sockets: WebSocket[] = [];
    const connect = async (path: string) => {
        const socket = new WebSocket(base.replace("http", "ws") + path);
        sockets.push(socket);
        await once(socket, "open");
        return socket;
    };
    disposals.push(async () => {
        sockets.forEach(socket => socket.terminate());
        await app.stop();
        rmSync(directory, { recursive: true, force: true });
    });
    const json = async (path: string) => (await fetch(base + path)).json();
    return {
        app,
        base,
        connect,
        json,
        queryEntered,
        releaseQuery: () => releaseQuery?.(),
        recoverPlatform: () => {
            rejectRecovery = false;
        },
    };
}

describe("账号和协议热插拔公开效果", () => {
    it("其他账号等待登录不阻止局部配置，受影响启动账号则明确拒绝", async () => {
        const { app, json } = await fixture();
        const adapter = app.adapters.get("hotplug-test");
        const pendingAccount = adapter?.accounts.get("b");
        if (!adapter || !pendingAccount) throw new Error("测试账号不存在");
        await pendingAccount.stop();
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>(resolve => {
            entered = resolve;
        });
        const waiting = new Promise<void>(resolve => {
            release = resolve;
        });
        pendingAccount.on("start", async () => {
            entered();
            await waiting;
            pendingAccount.status = AccountStatus.Online;
        });
        const starting = adapter.start("b");
        await started;
        try {
            const next = structuredClone(app.config);
            next["hotplug-test.a"]["hotplug-test.v1"] = { label: "unblocked" };
            expect((await app.applyRuntimeConfiguration(next)).status).toBe("applied");
            expect(await json("/hotplug-test/a/hotplug-test/v1")).toEqual({ label: "unblocked" });
            const changedPending = structuredClone(app.config);
            changedPending["hotplug-test.b"].token = "blocked";
            await expect(app.applyRuntimeConfiguration(changedPending)).rejects.toThrow(
                "受影响账号仍在启动",
            );
            const added = structuredClone(app.config);
            added["hotplug-test.c"] = { "hotplug-test.v1": { label: "added while B waits" } };
            expect((await app.applyRuntimeConfiguration(added)).status).toBe("applied");
            expect(await json("/hotplug-test/c/hotplug-test/v1")).toEqual({
                label: "added while B waits",
            });
        } finally {
            release();
            await starting;
        }
    });
    it("同一账号显式重新启动开启新操作入口，替换后的旧协议引用仍被拒绝", async () => {
        const { app, json } = await fixture();
        const account = app.adapters.get("hotplug-test")?.accounts.get("a");
        if (!account) throw new Error("测试账号不存在");
        await account.stop();
        await account.start();
        expect(await json("/hotplug-test/a/hotplug-test/v1")).toEqual({ label: "old" });
        const oldProtocol = account.protocols[0];
        expect(await oldProtocol.apply("readiness check")).toEqual({});
        const next = structuredClone(app.config);
        next["hotplug-test.a"]["hotplug-test.v1"] = { label: "new" };
        await app.applyRuntimeConfiguration(next);
        await expect(oldProtocol.apply("query")).rejects.toThrow("操作未受理");
    });
    it("SDK 操作无法及时排空时拒绝热配置而不停止账号，也不更新配置快照", async () => {
        const { app, json, queryEntered, releaseQuery } = await fixture();
        await app.applyRuntimeConfiguration({ ...structuredClone(app.config), timeout: 1 });
        const callback = await json("/hotplug-test/a/callback");
        const previous = structuredClone(app.config);
        const query = json("/hotplug-test/a/hotplug-test/v1/query");
        await queryEntered;
        const next = structuredClone(app.config);
        next["hotplug-test.a"].token = "not applied";
        await expect(app.applyRuntimeConfiguration(next)).rejects.toThrow("热配置未受理");
        expect(app.config).toEqual(previous);
        expect(await json("/hotplug-test/a/callback")).toEqual(callback);
        releaseQuery();
        expect(await query).toEqual({ sentBy: String(callback.identity) });
        expect(await json("/hotplug-test/b/hotplug-test/v1")).toEqual({ label: "unaffected" });
    });
    it("协议查询和内层发送完成后才重连账号，排空期间其他账号保持可用", async () => {
        const { app, json, queryEntered, releaseQuery } = await fixture();
        const callback = await json("/hotplug-test/a/callback");
        const query = json("/hotplug-test/a/hotplug-test/v1/query");
        await queryEntered;
        const next = structuredClone(app.config);
        next["hotplug-test.a"].token = "reconnect";
        const applying = app.applyRuntimeConfiguration(next);
        expect(await json("/hotplug-test/a/callback")).toEqual(callback);
        expect(await json("/hotplug-test/b/hotplug-test/v1")).toEqual({ label: "unaffected" });
        releaseQuery();
        expect(await query).toEqual({ sentBy: String(callback.identity) });
        expect((await applying).status).toBe("applied");
        expect(await json("/hotplug-test/a/callback")).not.toEqual(callback);
    });
    it("有效值未变也保留新的覆盖关系，后续默认值变更能正确生效", async () => {
        const { app, json } = await fixture();
        const next = structuredClone(app.config);
        next.general = { "hotplug-test.v1": { label: "old" } };
        await app.applyRuntimeConfiguration(next);
        const callback = await json("/hotplug-test/a/callback");
        delete next["hotplug-test.a"]["hotplug-test.v1"].label;
        expect((await app.applyRuntimeConfiguration(next)).impact.mode).toBe("none");
        next.general["hotplug-test.v1"].label = "changed default";
        await app.applyRuntimeConfiguration(next);
        expect(await json("/hotplug-test/a/hotplug-test/v1")).toEqual({ label: "changed default" });
        expect(await json("/hotplug-test/a/callback")).toEqual(callback);
        expect(await json("/hotplug-test/b/hotplug-test/v1")).toEqual({ label: "unaffected" });
    });
    it("无变化不触碰连接，新增账号和协议不会重建旧账号", async () => {
        const { app, json } = await fixture();
        const before = await json("/hotplug-test/a/callback");
        expect((await app.applyRuntimeConfiguration(structuredClone(app.config))).impact.mode).toBe(
            "none",
        );
        const next = structuredClone(app.config);
        next["hotplug-test.c"] = { token: "c", "hotplug-test.v2": { label: "added" } };
        delete next["hotplug-test.a"]["hotplug-test.v2"];
        await app.applyRuntimeConfiguration(next);
        next["hotplug-test.a"]["hotplug-test.v2"] = { label: "restored" };
        await app.applyRuntimeConfiguration(next);
        expect(await json("/hotplug-test/c/hotplug-test/v2")).toEqual({ label: "added" });
        expect(await json("/hotplug-test/a/hotplug-test/v2")).toEqual({ label: "restored" });
        expect(await json("/hotplug-test/a/callback")).toEqual(before);
    });
    it("只替换选中协议，保留账号连接、其他协议和其他账号的 WS", async () => {
        const { app, connect, json } = await fixture();
        const callback = await json("/hotplug-test/a/callback");
        const socket = await connect("/hotplug-test/b/hotplug-test/v1");
        const other = await connect("/hotplug-test/a/hotplug-test/v2");
        const next = structuredClone(app.config);
        next["hotplug-test.a"]["hotplug-test.v1"] = { label: "new" };
        expect((await app.applyRuntimeConfiguration(next)).status).toBe("applied");
        expect(await json("/hotplug-test/a/callback")).toEqual(callback);
        expect(await json("/hotplug-test/a/hotplug-test/v1")).toEqual({ label: "new" });
        for (const connection of [socket, other]) {
            const message = once(connection, "message");
            connection.send("still connected");
            expect(String((await message)[0])).toBe("still connected");
        }
    });

    it("账号重连后共享回调仍可用，删除协议与账号只关闭对应入口", async () => {
        const { app, base, json } = await fixture();
        const oldAccount = app.adapters.get("hotplug-test")?.accounts.get("a");
        const oldProtocol = oldAccount?.protocols[0];
        const old = await json("/hotplug-test/a/callback");
        const b = await json("/hotplug-test/b/callback");
        const next = structuredClone(app.config);
        next["hotplug-test.a"].token = "changed";
        expect((await app.applyRuntimeConfiguration(next)).status).toBe("applied");
        await expect(oldProtocol?.apply("query")).rejects.toThrow("操作未受理");
        expect(await json("/hotplug-test/a/callback")).not.toEqual(old);
        expect(await json("/hotplug-test/b/callback")).toEqual(b);
        delete next["hotplug-test.a"]["hotplug-test.v1"];
        await app.applyRuntimeConfiguration(next);
        expect((await fetch(base + "/hotplug-test/a/hotplug-test/v1")).status).toBe(404);
        expect((await fetch(base + "/hotplug-test/a/hotplug-test/v2")).status).toBe(200);
        delete next["hotplug-test.a"];
        await app.applyRuntimeConfiguration(next);
        expect((await fetch(base + "/hotplug-test/a/callback")).status).toBe(404);
        expect(await json("/hotplug-test/b/callback")).toEqual(b);
    });

    it("协议启动失败恢复原入口，并保持未涉及账号可用", async () => {
        const { app, json } = await fixture();
        const callback = await json("/hotplug-test/a/callback");
        const next = structuredClone(app.config);
        next["hotplug-test.a"]["hotplug-test.v1"] = { fail: true };
        expect((await app.applyRuntimeConfiguration(next)).status).toBe("rolled_back");
        expect(await json("/hotplug-test/a/hotplug-test/v1")).toEqual({ label: "old" });
        expect(await json("/hotplug-test/a/callback")).toEqual(callback);
        expect(await json("/hotplug-test/b/hotplug-test/v1")).toEqual({ label: "unaffected" });
    });

    it("有效默认值改变只更新引用该协议的账号，冷配置无副作用", async () => {
        const { app, json } = await fixture();
        const next = structuredClone(app.config);
        next.general = { "hotplug-test.v1": { use_http: false } };
        expect(planRuntimeConfiguration(app.config, next).protocols).toHaveLength(2);
        const before = await json("/hotplug-test/a/callback");
        await expect(app.applyRuntimeConfiguration({ ...next, port: 7777 })).rejects.toThrow(
            "需要重启",
        );
        expect(await json("/hotplug-test/a/callback")).toEqual(before);
    });
    it("恢复也失败时明确报告 recovery_required，其他账号仍可用", async () => {
        const { app, json, recoverPlatform } = await fixture();
        const next = structuredClone(app.config);
        next["hotplug-test.a"]["hotplug-test.v1"] = { failRecovery: true };
        expect((await app.applyRuntimeConfiguration(next)).status).toBe("recovery_required");
        await expect(app.applyRuntimeConfiguration(structuredClone(app.config))).rejects.toThrow(
            "恢复未完成",
        );
        expect(await json("/hotplug-test/b/hotplug-test/v1")).toEqual({ label: "unaffected" });
        recoverPlatform();
        await app.reload(structuredClone(app.config));
        expect((await app.applyRuntimeConfiguration(structuredClone(app.config))).status).toBe(
            "applied",
        );
    });
});
