import { describe, expect, it, vi } from "vitest";
import { createDiscordLite } from "./bot-client.js";

describe("createDiscordLite", () => {
    it("manual 模式无需 HTTP 验签凭据即可接收上游已验证事件", async () => {
        const client = createDiscordLite({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });

        expect(client.getMode()).toBe("manual");
        await expect(
            client.ingestInteraction({
                id: "2",
                application_id: "1",
                type: 1,
                token: "interaction-token",
                version: 1,
            }),
        ).resolves.toEqual({ type: 1 });

        const onWebhookEvent = vi.fn();
        client.on("webhookEvent", onWebhookEvent);
        await expect(
            client.ingest({
                version: 1,
                application_id: "1",
                type: 1,
                event: { type: "ENTITLEMENT_CREATE", timestamp: "2026-08-30T00:00:00Z" },
            }),
        ).resolves.toMatchObject({ type: 1 });
        expect(onWebhookEvent).toHaveBeenCalledOnce();
    });

    it("将 Interactions 接收模式闭合到统一客户端", async () => {
        const client = createDiscordLite({
            account_id: "bot",
            token: "token",
            receive_mode: "interactions",
            application_id: "1",
            public_key: "00".repeat(32),
        });

        expect(client.getMode()).toBe("interactions");
        expect(client.initInteractions()).toBe(client.initInteractions());
        await expect(
            client.ingestInteraction({
                id: "2",
                application_id: "1",
                type: 2,
                token: "interaction-token",
                version: 1,
                data: { name: "external-handler" },
            }),
        ).resolves.toEqual({ type: 5, data: {} });
    });

    it("在建立 Gateway 前拒绝非法分片", () => {
        expect(() =>
            createDiscordLite({
                account_id: "bot",
                token: "token",
                shard: { id: 2, total: 2 },
            }),
        ).toThrow("shard.id 必须从 0 开始且小于 shard.total");
    });

    it("在启动前拒绝无效代理与 Presence 活动", () => {
        expect(() =>
            createDiscordLite({
                account_id: "bot",
                token: "token",
                proxy: { url: "ftp://127.0.0.1" },
            }),
        ).toThrow("代理地址必须使用 HTTP(S) 或 SOCKS");
        expect(() =>
            createDiscordLite({
                account_id: "bot",
                token: "token",
                presence: { activities: [{ name: "broken", type: 9 }] },
            }),
        ).toThrow("活动类型必须在 0-5 之间");
    });
});
