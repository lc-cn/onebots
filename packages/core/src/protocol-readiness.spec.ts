import Koa from "koa";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Account } from "./account.js";
import type { Adapter } from "./adapter.js";
import { Protocol } from "./protocol.js";
import { ProtocolRegistry } from "./registry.js";
import { Router } from "./router.js";

function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    ProtocolRegistry.unregister("readiness-test");
});

async function fixture(enforce = true) {
    const koa = new Koa();
    const server = createServer(koa.callback());
    const router = new Router(server);
    koa.use(router.routes());
    const startup = deferred();
    const registered = deferred();
    const stopping = deferred();
    const stopEntered = deferred();
    class TestProtocol extends Protocol {
        readonly name = "readiness-test";
        readonly version = "v1";
        constructor(adapter: Adapter, account: Account, config: Record<string, unknown>) {
            super(adapter, account, { ...config, protocol: "readiness-test", version: "v1" });
            this.router.get("/constructor", ctx => {
                ctx.body = "constructed";
            });
            this.router.ws("/constructor-ws");
        }
        async start() {
            await Promise.resolve();
            this.router.get("/protocol", ctx => {
                ctx.body = "ready";
            });
            this.router.ws("/protocol-ws");
            registered.resolve();
            await startup.promise;
        }
        async stop() {
            stopEntered.resolve();
            await stopping.promise;
        }
        dispatch() {}
        format() {
            return {};
        }
        async apply() {
            return {};
        }
    }
    ProtocolRegistry.register("readiness-test", "v1", TestProtocol);
    const adapter = {
        platform: "mock",
        resolveAccountStartupTimeoutSeconds: () => 30,
        app: {
            router,
            config: { general: {}, timeout: 30 },
            getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
        },
    } as unknown as Adapter;
    const account = new Account(adapter, {}, { account_id: "bot" } as never);
    const scope = router.createRegistrationScope({ platform: "mock", account_id: "bot" });
    account.attachRouteScope(scope);
    const protocol = scope.run(() => {
        router.get("/callback", ctx => {
            ctx.body = "login callback";
        });
        router.ws("/callback-ws");
        return ProtocolRegistry.create("readiness-test", "v1", adapter, account, {});
    });
    account.protocols = [protocol];
    if (enforce) router.enableProtocolReadiness();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("监听失败");
    const base = `http://127.0.0.1:${address.port}`;
    cleanups.push(async () => {
        startup.resolve();
        stopping.resolve();
        await account.stop();
        await router.cleanupAsync();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });
    async function wsStatus(path: string) {
        return new Promise<number>((resolve, reject) => {
            const socket = new WebSocket(base.replace("http", "ws") + path);
            socket.once("open", () => {
                socket.close();
                resolve(101);
            });
            socket.once("unexpected-response", (_request, response) => {
                response.resume();
                socket.terminate();
                resolve(response.statusCode ?? 0);
            });
            socket.on("error", error => {
                // terminate after a rejected upgrade also emits an error; the result is already settled.
                reject(error);
            });
        });
    }
    return {
        account,
        protocol,
        router,
        startup,
        registered,
        stopping,
        stopEntered,
        base,
        wsStatus,
    };
}

describe("managed protocol readiness ingress", () => {
    it("guards constructor and asynchronous start routes while leaving platform callbacks usable", async () => {
        const f = await fixture();
        expect((await fetch(f.base + "/constructor")).status).toBe(503);
        expect(await f.wsStatus("/constructor-ws")).toBe(503);
        const starting = f.account.start();
        await f.registered.promise;
        expect((await fetch(f.base + "/protocol")).status).toBe(503);
        expect(await f.wsStatus("/protocol-ws")).toBe(503);
        expect(await (await fetch(f.base + "/callback")).text()).toBe("login callback");
        expect(await f.wsStatus("/callback-ws")).toBe(101);
        f.startup.resolve();
        await starting;
        expect((await fetch(f.base + "/constructor")).status).toBe(200);
        expect((await fetch(f.base + "/protocol")).status).toBe(200);
        expect(await f.wsStatus("/protocol-ws")).toBe(101);
    });

    it("rejects routes left by failed protocol startup", async () => {
        const f = await fixture();
        const result = expect(f.account.start()).rejects.toThrow("协议失败");
        await f.registered.promise;
        f.startup.reject(new Error("协议失败"));
        await result;
        expect(f.protocol.lifecycleStatus).toBe("failed");
        expect((await fetch(f.base + "/protocol")).status).toBe(503);
        expect(await f.wsStatus("/protocol-ws")).toBe(503);
        expect((await fetch(f.base + "/callback")).status).toBe(200);
    });

    it("refuses stopping protocols before cleanup and preserves account route removal", async () => {
        const f = await fixture();
        const starting = f.account.start();
        await f.registered.promise;
        f.startup.resolve();
        await starting;
        // Protocol stop hooks may begin before account-wide resource cleanup.
        f.protocol.lifecycleStatus = "stopping";
        expect((await fetch(f.base + "/protocol")).status).toBe(503);
        expect(await f.wsStatus("/protocol-ws")).toBe(503);
        const stopping = f.account.stop();
        await f.stopEntered.promise;
        expect((await fetch(f.base + "/protocol")).status).toBe(404);
        expect(await f.wsStatus("/protocol-ws")).toBe(404);
        f.stopping.resolve();
        await stopping;
        expect(f.router.getWsPaths()).toEqual([]);
    });

    it("preserves direct protocol start compatibility until managed mode is enabled", async () => {
        const f = await fixture(false);
        expect((await fetch(f.base + "/constructor")).status).toBe(200);
        expect(await f.wsStatus("/constructor-ws")).toBe(101);
        f.router.enableProtocolReadiness();
        expect((await fetch(f.base + "/constructor")).status).toBe(503);
        expect(await f.wsStatus("/constructor-ws")).toBe(503);
    });
});
