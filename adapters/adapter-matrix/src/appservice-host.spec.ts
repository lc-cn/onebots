import type { BaseApp } from "onebots";
import { createServer } from "node:http";
import { Router } from "../../../packages/core/src/router.js";
import { describe, expect, it, vi } from "vitest";
import { MatrixAppserviceHost } from "./appservice-host.js";
import { MatrixClient } from "./client.js";
import type { MatrixConfig } from "./types.js";

interface TestContext {
    method: string;
    url: string;
    status: number;
    body: unknown;
    request: { body?: unknown };
    get(name: string): string;
    set(name: string, value: string): void;
}

type Handler = (ctx: TestContext) => Promise<void>;

const config = (accountId: string, path?: string): MatrixConfig => ({
    account_id: accountId,
    homeserver_url: "https://matrix.example.com",
    user_id: `@${accountId}:example.com`,
    receive_mode: "appservice",
    appservice_id: `as-${accountId}`,
    as_token: "as-secret",
    hs_token: "hs-secret",
    appservice_path: path,
});

describe("MatrixAppserviceHost", () => {
    it("部分路由冲突时关闭作用域并允许重试完整注册", () => {
        const router = new Router(createServer());
        const blocker = router.createRegistrationScope({ platform: "other" });
        blocker.run(() => router.post("/shared/_matrix/app/v1/ping", () => undefined));
        const current = new MatrixClient(config("bot", "/shared"));
        const host = new MatrixAppserviceHost({ router } as unknown as BaseApp, () => current);
        try {
            expect(() => host.mount("bot", current, "/matrix/bot")).toThrow();
            expect(router.stack).toHaveLength(1);
            blocker.close();
            host.mount("bot", current, "/matrix/bot");
            expect(router.stack).toHaveLength(4);
        } finally {
            router.cleanup();
        }
    });
    it("路由热重载后解析当前 Client，不捕获旧实例", async () => {
        const routes = new Map<string, Handler>();
        const router = {
            createRegistrationScope: () => ({
                run: <T>(operation: () => T) => operation(),
                close: () => undefined,
            }),
            put: vi.fn((path: string, handler: Handler) => routes.set(`PUT ${path}`, handler)),
            post: vi.fn((path: string, handler: Handler) => routes.set(`POST ${path}`, handler)),
            get: vi.fn((path: string, handler: Handler) => routes.set(`GET ${path}`, handler)),
        };
        const clients = new Map<string, MatrixClient>();
        const host = new MatrixAppserviceHost({ router } as unknown as BaseApp, accountId =>
            clients.get(accountId),
        );
        const oldClient = new MatrixClient(config("bot"));
        const newClient = new MatrixClient(config("bot"));
        const oldIngest = vi.spyOn(oldClient, "ingestHttp");
        const newIngest = vi
            .spyOn(newClient, "ingestHttp")
            .mockResolvedValue({ status: 200, headers: {}, body: {} });

        clients.set("bot", oldClient);
        host.mount("bot", oldClient, "/matrix/bot");
        clients.set("bot", newClient);
        host.mount("bot", newClient, "/matrix/bot");

        const handler = routes.get("PUT /matrix/bot/appservice/_matrix/app/v1/transactions/:txnId");
        expect(handler).toBeDefined();
        await handler?.(context("/matrix/bot/appservice/_matrix/app/v1/transactions/t1"));
        expect(oldIngest).not.toHaveBeenCalled();
        expect(newIngest).toHaveBeenCalledOnce();
        expect(router.put).toHaveBeenCalledOnce();
    });

    it("路径变更后旧路由失活，并拒绝活跃账号之间的路径冲突", async () => {
        const routes = new Map<string, Handler>();
        let registered: string[] | undefined;
        const router = {
            createRegistrationScope: () => {
                const owned: string[] = [];
                return {
                    run: <T>(operation: () => T) => {
                        registered = owned;
                        try {
                            return operation();
                        } finally {
                            registered = undefined;
                        }
                    },
                    close: () => owned.forEach(key => routes.delete(key)),
                };
            },
            put: (path: string, handler: Handler) => register("PUT", path, handler),
            post: (path: string, handler: Handler) => register("POST", path, handler),
            get: (path: string, handler: Handler) => register("GET", path, handler),
        };
        const register = (method: string, path: string, handler: Handler) => {
            const key = `${method} ${path}`;
            routes.set(key, handler);
            registered?.push(key);
        };
        const clients = new Map<string, MatrixClient>();
        const host = new MatrixAppserviceHost({ router } as unknown as BaseApp, accountId =>
            clients.get(accountId),
        );
        const first = new MatrixClient(config("first", "/shared"));
        clients.set("first", first);
        host.mount("first", first, "/matrix/first");

        const second = new MatrixClient(config("second", "/shared"));
        clients.set("second", second);
        expect(() => host.mount("second", second, "/matrix/second")).toThrow(/已由账号/u);

        const moved = new MatrixClient(config("first", "/new"));
        clients.set("first", moved);
        host.mount("first", moved, "/matrix/first");
        expect(routes.has("POST /shared/_matrix/app/v1/ping")).toBe(false);
    });
});

function context(url: string, method = "PUT"): TestContext {
    return {
        method,
        url,
        status: 0,
        body: undefined,
        request: { body: {} },
        get: () => "Bearer hs-secret",
        set: () => undefined,
    };
}
