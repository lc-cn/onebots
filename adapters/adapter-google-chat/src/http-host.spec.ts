import type { BaseApp } from "onebots";
import { createServer } from "node:http";
import { Router, HttpRouteConflictError } from "../../../packages/core/src/router.js";
import { describe, expect, it, vi } from "vitest";
import { GoogleChatClient } from "./client.js";
import { GoogleChatHttpHost } from "./http-host.js";
import type { GoogleChatConfig } from "./types.js";

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

describe("GoogleChatHttpHost", () => {
    it("真实路由冲突保留双方平台归属，失败不遗留挂载且修正后可重试", () => {
        const router = new Router(createServer());
        const current = new GoogleChatClient(config("bot", "/events"));
        const host = new GoogleChatHttpHost({ router } as unknown as BaseApp, () => current);
        const blocker = router.createRegistrationScope({ platform: "other" });
        try {
            blocker.run(() => router.post("/events", () => undefined));
            try {
                host.mount("bot", current);
                throw new Error("应拒绝重复路由");
            } catch (error) {
                expect(error).toBeInstanceOf(HttpRouteConflictError);
                expect(error).toMatchObject({
                    registeringOwner: { platform: "google-chat" },
                    existingOwner: { platform: "other" },
                });
            }
            expect(router.stack).toHaveLength(1);
            blocker.close();
            host.mount("bot", current);
            expect(router.stack).toHaveLength(1);
            host.unmount("bot");
            expect(router.stack).toHaveLength(0);
            host.mount("bot", current);
            expect(router.stack).toHaveLength(1);
        } finally {
            router.cleanup();
        }
    });
    it("热重载后解析当前 Client，不捕获旧实例", async () => {
        const routes = new Map<string, Handler>();
        const router = {
            createRegistrationScope: () => ({
                run: <T>(operation: () => T) => operation(),
                close: () => undefined,
            }),
            post: vi.fn((path: string, handler: Handler) => routes.set(path, handler)),
        };
        const clients = new Map<string, GoogleChatClient>();
        const host = new GoogleChatHttpHost({ router } as unknown as BaseApp, accountId =>
            clients.get(accountId),
        );
        const oldClient = new GoogleChatClient(config("bot", "/events"));
        const currentClient = new GoogleChatClient(config("bot", "/events"));
        const oldIngest = vi.spyOn(oldClient, "ingestHttp");
        const currentIngest = vi
            .spyOn(currentClient, "ingestHttp")
            .mockResolvedValue({ status: 200, headers: {}, body: { ok: true } });

        clients.set("bot", oldClient);
        host.mount("bot", oldClient);
        clients.set("bot", currentClient);
        host.mount("bot", currentClient);

        const ctx = context("/events");
        await routes.get("/events")?.(ctx);
        expect(oldIngest).not.toHaveBeenCalled();
        expect(currentIngest).toHaveBeenCalledOnce();
        expect(ctx).toMatchObject({ status: 200, body: { ok: true } });
        expect(router.post).toHaveBeenCalledOnce();
    });

    it("拒绝活跃账号路径冲突，路径迁移后旧路由失活", async () => {
        const routes = new Map<string, Handler>();
        const router = {
            createRegistrationScope: () => ({
                run: <T>(operation: () => T) => operation(),
                close: () => undefined,
            }),
            post: (path: string, handler: Handler) => routes.set(path, handler),
        };
        const clients = new Map<string, GoogleChatClient>();
        const host = new GoogleChatHttpHost({ router } as unknown as BaseApp, accountId =>
            clients.get(accountId),
        );
        const first = new GoogleChatClient(config("first", "/shared"));
        clients.set("first", first);
        host.mount("first", first);

        const second = new GoogleChatClient(config("second", "/shared"));
        clients.set("second", second);
        expect(() => host.mount("second", second)).toThrow(/已由账号/u);

        const moved = new GoogleChatClient(config("first", "/new"));
        clients.set("first", moved);
        host.mount("first", moved);
        const ctx = context("/shared");
        await routes.get("/shared")?.(ctx);
        expect(ctx.status).toBe(404);
    });
});

function config(accountId: string, path: string): GoogleChatConfig {
    return {
        account_id: accountId,
        auth_mode: "access-token",
        access_token: "token",
        receive_mode: "interaction-http",
        http_path: path,
        verification_audience: `https://host.example${path}`,
    };
}

function context(url: string): TestContext {
    return {
        method: "POST",
        url,
        status: 0,
        body: undefined,
        request: { body: {} },
        get: () => "Bearer signed",
        set: () => undefined,
    };
}
