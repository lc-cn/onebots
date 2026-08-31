import type { BaseApp } from "onebots";
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
    it("路由热重载后解析当前 Client，不捕获旧实例", async () => {
        const routes = new Map<string, Handler>();
        const router = {
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
        const router = {
            put: (path: string, handler: Handler) => routes.set(`PUT ${path}`, handler),
            post: (path: string, handler: Handler) => routes.set(`POST ${path}`, handler),
            get: (path: string, handler: Handler) => routes.set(`GET ${path}`, handler),
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
        const stale = routes.get("POST /shared/_matrix/app/v1/ping");
        const ctx = context("/shared/_matrix/app/v1/ping", "POST");
        await stale?.(ctx);
        expect(ctx.status).toBe(404);
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
