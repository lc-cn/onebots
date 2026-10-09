import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DouyinVerificationProxy, rewriteVerificationHtml } from "./verification-proxy.js";

const servers: Server[] = [];

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map(
            server =>
                new Promise<void>(resolve => {
                    server.close(() => resolve());
                }),
        ),
    );
});

describe("Douyin 验证页代理", () => {
    it("只发布 SDK 本机挑战地址，并为网关前缀生成同源能力路径", () => {
        const fixture = createProxy("/gateway");
        const path = fixture.proxy.publish(
            "bot",
            "browser-verification",
            "http://127.0.0.1:12345/?token=upstream-secret",
        );

        expect(path).toMatch(/^\/gateway\/_onebots\/douyin-verification\/[0-9a-f]{64}$/u);
        expect(path).not.toContain("upstream-secret");
        expect(() =>
            fixture.proxy.publish("bot", "browser-verification", "http://example.com/?token=x"),
        ).toThrow("不是受支持的本机挑战地址");
    });

    it("代理当前挑战、重写页面绝对路径，并在撤销后拒绝访问", async () => {
        const received: Array<{ url: string; body: string; authorization?: string }> = [];
        const upstream = createServer(async (request, response) => {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            received.push({
                url: request.url ?? "",
                body: Buffer.concat(chunks).toString("utf8"),
                authorization: request.headers.authorization,
            });
            if (request.url?.startsWith("/api/complete")) {
                response.writeHead(200, { "content-type": "application/json" });
                response.end('{"ok":true}');
            } else {
                response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
                response.end(
                    `<script src="/react.js?token=upstream-secret"></script>` +
                        `<script>fetch('/api/complete?token=upstream-secret');document.cookie='fp=x; path=/';</script>`,
                );
            }
        });
        servers.push(upstream);
        upstream.listen(0, "127.0.0.1");
        await once(upstream, "listening");
        const address = upstream.address();
        if (!address || typeof address === "string") throw new Error("测试服务器地址无效");

        const fixture = createProxy("");
        const publicPath = fixture.proxy.publish(
            "bot",
            "browser-verification",
            `http://127.0.0.1:${address.port}/?token=upstream-secret`,
        );
        const ctx = context(publicPath);
        await fixture.handlers[0]!(ctx as never);

        expect(ctx.status).toBe(200);
        expect(String(ctx.body)).toContain(`${publicPath}/react.js?token=upstream-secret`);
        expect(String(ctx.body)).toContain(`${publicPath}/api/complete?token=upstream-secret`);
        expect(String(ctx.body)).toContain(`path=${publicPath}/`);
        expect(ctx.responseHeaders["cache-control"]).toBe("no-store");
        expect(received[0]).toEqual({
            url: "/?token=upstream-secret",
            body: "",
            authorization: undefined,
        });

        const submission = context(`${publicPath}/api/complete?token=browser-copy`);
        submission.method = "POST";
        submission.headers = {
            authorization: "Bearer management-secret",
            cookie: "manager=session",
            "content-type": "application/json",
            "x-forwarded-for": "198.51.100.20",
        };
        submission.request.rawBody = Buffer.from('{"result":{"status":true}}');
        await fixture.handlers[1]!(submission as never);
        expect(received[1]).toEqual({
            url: "/api/complete?token=upstream-secret",
            body: '{"result":{"status":true}}',
            authorization: undefined,
        });

        fixture.proxy.revoke("bot", "browser-verification");
        const expired = context(publicPath);
        await fixture.handlers[0]!(expired as never);
        expect(expired.status).toBe(404);
    });

    it("只改写已知的本地验证资源路径", () => {
        expect(
            rewriteVerificationHtml(
                `<script src='/react-dom.js?token=x'></script><a href='/other'>other</a>`,
                "/proxy/key",
            ),
        ).toBe(`<script src='/proxy/key/react-dom.js?token=x'></script><a href='/other'>other</a>`);
    });
});

function createProxy(path: string) {
    const handlers: Array<(ctx: unknown) => Promise<void>> = [];
    const router = {
        all: vi.fn((_route: string, handler: (ctx: unknown) => Promise<void>) => {
            handlers.push(handler);
        }),
    };
    return {
        handlers,
        proxy: new DouyinVerificationProxy({ config: { path }, router } as never),
    };
}

function context(path: string) {
    const responseHeaders: Record<string, string> = {};
    return {
        method: "GET",
        path,
        url: path,
        headers: { accept: "text/html" } as Record<string, string>,
        request: { rawBody: undefined as Buffer | undefined },
        status: 0,
        body: undefined as unknown,
        responseHeaders,
        set(name: string, value: string) {
            responseHeaders[name.toLowerCase()] = value;
        },
    };
}
