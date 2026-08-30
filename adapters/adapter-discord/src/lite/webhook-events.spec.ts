import { describe, expect, it, vi } from "vitest";
import { DiscordWebhookEventsReceiver } from "./webhook-events.js";

const publicKey = "00".repeat(32);

describe("Discord Webhook Events", () => {
    it("识别 Ping 且不进入业务事件", async () => {
        const onEvent = vi.fn();
        const receiver = new DiscordWebhookEventsReceiver({
            publicKey,
            applicationId: "app",
            onEvent,
        });

        await expect(
            receiver.ingest({ version: 1, application_id: "app", type: 0 }),
        ).resolves.toMatchObject({ type: 0 });
        expect(onEvent).not.toHaveBeenCalled();
    });

    it("只在异步业务投递成功后提交去重身份", async () => {
        const onEvent = vi
            .fn()
            .mockRejectedValueOnce(new Error("temporary"))
            .mockResolvedValueOnce();
        const receiver = new DiscordWebhookEventsReceiver({
            publicKey,
            applicationId: "app",
            onEvent,
        });
        const event = {
            version: 1,
            application_id: "app",
            type: 1,
            event: { type: "ENTITLEMENT_CREATE", timestamp: "2026-08-30T00:00:00Z", data: {} },
        };

        await expect(receiver.ingest(event)).rejects.toMatchObject({
            code: "DISCORD_WEBHOOK_EVENT_DELIVERY_FAILED",
        });
        await expect(receiver.ingest(event)).resolves.toEqual(event);
        await expect(receiver.ingest(event)).resolves.toEqual(event);
        expect(onEvent).toHaveBeenCalledTimes(2);
    });

    it("拒绝其他应用的载荷", async () => {
        const receiver = new DiscordWebhookEventsReceiver({ publicKey, applicationId: "app" });
        await expect(
            receiver.ingest({ version: 1, application_id: "other", type: 0 }),
        ).rejects.toMatchObject({ code: "DISCORD_WEBHOOK_INVALID" });
    });

    it("验证真实签名并按 Discord 规范返回 204", async () => {
        const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
        const exported = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
        const timestamp = String(Math.floor(Date.now() / 1000));
        const body = JSON.stringify({ version: 1, application_id: "app", type: 0 });
        const signature = new Uint8Array(
            await crypto.subtle.sign(
                "Ed25519",
                keys.privateKey,
                new TextEncoder().encode(timestamp + body),
            ),
        );
        const receiver = new DiscordWebhookEventsReceiver({
            publicKey: hex(exported),
            applicationId: "app",
        });

        await expect(
            receiver.ingestHttp({ body, timestamp, signature: hex(signature) }),
        ).resolves.toEqual({
            status: 204,
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: null,
        });
        const response = await receiver.acceptHttp(
            new Request("https://example.test/events", {
                method: "POST",
                body,
                headers: {
                    "x-signature-ed25519": hex(signature),
                    "x-signature-timestamp": timestamp,
                },
            }),
        );
        expect(response.status).toBe(204);
        expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
        await expect(response.text()).resolves.toBe("");
    });
});

function hex(bytes: Uint8Array): string {
    return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
