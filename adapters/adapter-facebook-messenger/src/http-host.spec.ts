import { createHmac } from "node:crypto";
import type { BaseApp } from "onebots";
import { createServer } from "node:http";
import { Router, HttpRouteConflictError } from "../../../packages/core/src/router.js";
import { describe, expect, it, vi } from "vitest";
import { FacebookMessengerClient } from "./client.js";
import { FacebookMessengerHttpHost } from "./http-host.js";
import type { FacebookMessengerConfig } from "./types.js";

interface TestContext {
    method: string;
    url: string;
    status: number;
    body: unknown;
    request: { rawBody?: string | Uint8Array };
    get(name: string): string;
    set(name: string, value: string): void;
}

type Handler = (ctx: TestContext) => Promise<void>;

describe("FacebookMessengerHttpHost", () => {
    it("真实路由部分注册失败完整回滚，修正冲突后可重试并释放、重新挂载", () => {
        const router = new Router(createServer());
        const current = new FacebookMessengerClient(config("page", "/events"));
        const host = new FacebookMessengerHttpHost({ router } as unknown as BaseApp, () => current);
        const blocker = router.createRegistrationScope({ platform: "other" });
        try {
            blocker.run(() => router.post("/events", () => undefined));
            try {
                host.mount("current", current);
                throw new Error("应拒绝重复路由");
            } catch (error) {
                expect(error).toBeInstanceOf(HttpRouteConflictError);
                expect(error).toMatchObject({
                    registeringOwner: { platform: "facebook-messenger" },
                    existingOwner: { platform: "other" },
                });
            }
            expect(router.stack).toHaveLength(1);
            blocker.close();
            expect(router.stack).toHaveLength(0);
            host.mount("current", current);
            expect(router.stack).toHaveLength(2);
            host.unmount("current");
            expect(router.stack).toHaveLength(0);
            host.mount("current", current);
            expect(router.stack).toHaveLength(2);
        } finally {
            router.cleanup();
        }
    });
    it("GET/POST 共用路径，并在热重载后解析当前 Client", async () => {
        const getRoutes = new Map<string, Handler>();
        const postRoutes = new Map<string, Handler>();
        const router = {
            createRegistrationScope: () => ({
                run: <T>(operation: () => T) => operation(),
                close: () => undefined,
            }),
            get: vi.fn((path: string, handler: Handler) => getRoutes.set(path, handler)),
            post: vi.fn((path: string, handler: Handler) => postRoutes.set(path, handler)),
        };
        const clients = new Map<string, FacebookMessengerClient>();
        const host = new FacebookMessengerHttpHost({ router } as unknown as BaseApp, id =>
            clients.get(id),
        );
        const oldClient = new FacebookMessengerClient(config("page", "/events"));
        const current = new FacebookMessengerClient(config("page", "/events"));
        const oldIngest = vi.spyOn(oldClient, "ingestHttp");
        const currentIngest = vi
            .spyOn(current, "ingestHttp")
            .mockResolvedValue({ status: 200, headers: {}, body: "OK" });

        clients.set("page", oldClient);
        host.mount("page", oldClient);
        clients.set("page", current);
        host.mount("page", current);
        const raw = JSON.stringify({ object: "page", entry: [] });
        const ctx = context("POST", "/events", raw);
        await postRoutes.get("/events")?.(ctx);

        expect(oldIngest).not.toHaveBeenCalled();
        expect(currentIngest).toHaveBeenCalledWith(
            expect.objectContaining({ rawBody: new TextEncoder().encode(raw) }),
        );
        expect(ctx).toMatchObject({ status: 200, body: "OK" });
        expect(router.get).toHaveBeenCalledOnce();
        expect(router.post).toHaveBeenCalledOnce();
    });

    it("拒绝活跃账号路径冲突，路径迁移后旧路由失活", async () => {
        const router = new Router(createServer());
        try {
            const clients = new Map<string, FacebookMessengerClient>();
            const host = new FacebookMessengerHttpHost({ router } as unknown as BaseApp, id =>
                clients.get(id),
            );
            const first = new FacebookMessengerClient(config("first", "/shared"));
            clients.set("first", first);
            host.mount("first", first);
            const second = new FacebookMessengerClient(config("second", "/shared"));
            clients.set("second", second);
            expect(() => host.mount("second", second)).toThrow(/已由账号/u);

            const moved = new FacebookMessengerClient(config("first", "/new"));
            clients.set("first", moved);
            host.mount("first", moved);
            expect(router.stack).toHaveLength(2);
            expect(router.stack.every(layer => layer.path === "/new")).toBe(true);
            host.unmount("first");
            expect(router.stack).toHaveLength(0);
        } finally {
            router.cleanup();
        }
    });
});

function config(accountId: string, path: string): FacebookMessengerConfig {
    const pageId = accountId === "first" ? "101" : accountId === "second" ? "102" : "100";
    return {
        account_id: accountId,
        page_id: pageId,
        page_access_token: "token",
        app_secret: "secret",
        verify_token: "verify",
        receive_mode: "webhook",
        http_path: path,
    };
}

function context(method: string, url: string, rawBody: string | undefined): TestContext {
    return {
        method,
        url,
        status: 0,
        body: undefined,
        request: { rawBody },
        get: name =>
            name.toLowerCase() === "x-hub-signature-256" && rawBody
                ? `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`
                : "",
        set: () => undefined,
    };
}
