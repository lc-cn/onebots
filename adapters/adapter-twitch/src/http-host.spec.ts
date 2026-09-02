import type { BaseApp } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { TwitchHttpHost } from "./http-host.js";
import type { TwitchClient } from "./client.js";

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

describe("TwitchHttpHost", () => {
    it("热重载后把原始请求体交给当前 Client", async () => {
        const routes = new Map<string, Handler>();
        const router = {
            post: vi.fn((path: string, handler: Handler) => routes.set(path, handler)),
        };
        const oldClient = client();
        const currentClient = client();
        const clients = new Map<string, TwitchClient>([["account", oldClient]]);
        const host = new TwitchHttpHost({ router } as unknown as BaseApp, id => clients.get(id));
        host.mount("account", oldClient);
        clients.set("account", currentClient);
        host.mount("account", currentClient);

        const rawBody = JSON.stringify({ subscription: {}, event: {} });
        const ctx = context(rawBody);
        await routes.get("/twitch/events")?.(ctx);

        expect(oldClient.acceptHttp).not.toHaveBeenCalled();
        expect(currentClient.acceptHttp).toHaveBeenCalledOnce();
        const request = vi.mocked(currentClient.acceptHttp).mock.calls[0]?.[0];
        await expect(request?.text()).resolves.toBe(rawBody);
        expect(ctx).toMatchObject({ status: 204, body: undefined });
        expect(router.post).toHaveBeenCalledOnce();
    });

    it("缺少 rawBody 时拒绝验签，而不是使用空请求体", async () => {
        const routes = new Map<string, Handler>();
        const router = { post: (path: string, handler: Handler) => routes.set(path, handler) };
        const currentClient = client();
        const host = new TwitchHttpHost({ router } as unknown as BaseApp, () => currentClient);
        host.mount("account", currentClient);
        const ctx = context(undefined);

        await routes.get("/twitch/events")?.(ctx);

        expect(currentClient.acceptHttp).not.toHaveBeenCalled();
        expect(ctx).toMatchObject({
            status: 500,
            body: {
                error: {
                    code: "TWITCH_RAW_BODY_REQUIRED",
                    message: expect.stringContaining("rawBody"),
                },
            },
        });
    });
});

function client(): TwitchClient {
    return {
        receiveMode: "webhook",
        config: { http_path: "/twitch/events" },
        acceptHttp: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    } as unknown as TwitchClient;
}

function context(rawBody: string | undefined): TestContext {
    return {
        method: "POST",
        url: "/twitch/events",
        status: 0,
        body: undefined,
        request: { rawBody },
        get: name => (name.toLowerCase() === "content-type" ? "application/json" : "header"),
        set: () => undefined,
    };
}
