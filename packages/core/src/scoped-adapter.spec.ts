import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Adapter } from "./adapter.js";
import { defineAdapterCapabilities } from "./adapter-capability.js";
import type { BaseApp } from "./base-app.js";
import { BaseApp as BaseAppClass } from "./base-app.js";
import { AdapterRegistry } from "./registry.js";
import { Router } from "./router.js";
import { closeAdapterRouteScope } from "./scoped-adapter.js";

const capabilities = defineAdapterCapabilities({
    actions: {},
    events: {},
    segments: {},
    transports: {},
});

const routers = new Set<Router>();

afterEach(() => {
    vi.restoreAllMocks();
    AdapterRegistry.clear();
    for (const router of routers) router.cleanup();
    routers.clear();
});

describe("scoped adapter factory", () => {
    it("适配器候选验收失败时撤销构造期 HTTP 与 WebSocket 路由", () => {
        const app = appFixture();
        AdapterRegistry.register("expected", (() => {
            app.router.get("/ghost", () => undefined);
            app.router.ws("/ghost/events");
            return adapterFixture(app, "other");
        }) as Adapter.Factory);

        expect(() => AdapterRegistry.create("expected", app)).toThrow(
            "适配器 expected 工厂返回的平台身份不一致",
        );
        expect(app.router.stack).toHaveLength(0);
        expect(app.router.getWsPaths()).toEqual([]);
    });

    it("通过验收的适配器持有路由直至其作用域关闭", () => {
        const app = appFixture();
        AdapterRegistry.register("expected", (() => {
            app.router.get("/owned", () => undefined);
            app.router.ws("/owned/events");
            return adapterFixture(app, "expected");
        }) as Adapter.Factory);

        const adapter = AdapterRegistry.create("expected", app);
        expect(app.router.stack.map(layer => layer.path)).toEqual(["/owned"]);
        expect(app.router.getWsPaths()).toEqual(["/owned/events"]);

        closeAdapterRouteScope(adapter);
        expect(app.router.stack).toHaveLength(0);
        expect(app.router.getWsPaths()).toEqual([]);
    });

    it("适配器停止失败时仍由宿主关闭其路由作用域", async () => {
        const app = appFixture();
        const stopError = new Error("adapter stop failed");
        AdapterRegistry.register("expected", (() => {
            app.router.get("/owned", () => undefined);
            return adapterFixture(
                app,
                "expected",
                vi.fn(async () => Promise.reject(stopError)),
            );
        }) as Adapter.Factory);
        const adapter = AdapterRegistry.create("expected", app);
        app.adapters.set("expected", adapter);

        const stopAdapters = Reflect.get(BaseAppClass.prototype, "stopAdapters") as (
            this: BaseApp,
            throwOnFailure: boolean,
        ) => Promise<void>;
        await expect(stopAdapters.call(app, true)).rejects.toThrow("adapter stop failed");
        expect(app.router.stack).toHaveLength(0);
    });

    it("适配器创建后钩子失败时撤销发布和路由", () => {
        const app = appFixture();
        AdapterRegistry.register("expected", (() => {
            app.router.get("/owned", () => undefined);
            return adapterFixture(app, "expected");
        }) as Adapter.Factory);
        Reflect.set(app, "onAdapterCreated", () => {
            throw new Error("hook failed");
        });

        expect(() => BaseAppClass.prototype.findOrCreateAdapter.call(app, "expected")).toThrow(
            "hook failed",
        );
        expect(app.adapters.size).toBe(0);
        expect(app.router.stack).toHaveLength(0);
    });
});

function appFixture(): BaseApp {
    const router = new Router(createServer());
    routers.add(router);
    return {
        router,
        adapters: new Map(),
        enhancedLogger: { error: vi.fn() },
    } as unknown as BaseApp;
}

function adapterFixture(
    app: BaseApp,
    platform: string,
    stop: () => Promise<void> = vi.fn(async () => undefined),
): Adapter {
    return {
        app,
        platform,
        accounts: new Map(),
        callAction: async () => undefined,
        createAccount: () => {
            throw new Error("测试桩不创建账号");
        },
        createId: () => ({}),
        describeCapabilities: () => capabilities,
        emit: () => true,
        getAccount: () => undefined,
        isActionImplemented: () => true,
        off: () => undefined,
        on: () => undefined,
        resolveId: () => ({}),
        start: async () => undefined,
        stop,
    } as unknown as Adapter;
}
