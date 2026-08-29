import { describe, expect, it, vi } from "vitest";
import { QQClient } from "./client.js";
import { QQApiError } from "./errors.js";
import { resolveIntentMask } from "./types.js";
import { QQWebhookHost } from "./webhook-host.js";

describe("QQClient", () => {
    it("拒绝绝对 OpenAPI URL，避免凭据越界", async () => {
        const client = new QQClient(
            { appId: "app", appSecret: "secret" },
            { warn: vi.fn(), error: vi.fn() },
        );
        await expect(
            client.call({ method: "GET", path: "https://evil.example/users/@me" }),
        ).rejects.toMatchObject({ code: "QQ_INVALID_API_PATH" } satisfies Partial<QQApiError>);
        await expect(
            client.call({ method: "GET", path: "/guilds/%2e%2e/users/@me" }),
        ).rejects.toMatchObject({ code: "QQ_INVALID_API_PATH" } satisfies Partial<QQApiError>);
    });

    it("将可读 Intent 列表准确转换为官方位图", () => {
        expect(resolveIntentMask(["GUILDS", "GROUP_AND_C2C_EVENT", "INTERACTION"])).toBe(
            1 + 33554432 + 67108864,
        );
        expect(resolveIntentMask(undefined)).toBeUndefined();
    });

    it("DELETE 调用不会丢失 query", async () => {
        const client = new QQClient(
            { appId: "app", appSecret: "secret" },
            { warn: vi.fn(), error: vi.fn() },
        );
        const request = vi.spyOn(client.api, "delete").mockResolvedValue({ ok: true });
        await client.call({ method: "DELETE", path: "/resource", query: { force: true } });
        expect(request).toHaveBeenCalledWith("/resource?force=true");
    });

    it("写操作统一保留结构化 query", async () => {
        const client = new QQClient(
            { appId: "app", appSecret: "secret" },
            { warn: vi.fn(), error: vi.fn() },
        );
        const request = vi.spyOn(client.api, "post").mockResolvedValue({ ok: true });

        await client.call({
            method: "POST",
            path: "/resource",
            query: { cursor: "next", enabled: true },
            body: { value: 1 },
        });

        expect(request).toHaveBeenCalledWith("/resource?cursor=next&enabled=true", { value: 1 });
    });

    it("将已有 HTTP Host 的原始请求委托给同一 Webhook 管线", async () => {
        const host = new QQWebhookHost("/qq/test/webhook", "test", vi.fn());
        await host.listen(0, "/ignored", async request => ({
            status: 200,
            body: request.body.toString("utf8"),
        }));
        const client = new QQClient(
            { appId: "app", appSecret: "secret" },
            { warn: vi.fn(), error: vi.fn() },
            host,
        );

        await expect(client.ingest({ body: Buffer.from("{}"), headers: {} })).resolves.toEqual({
            status: 200,
            body: "{}",
        });
    });
});
