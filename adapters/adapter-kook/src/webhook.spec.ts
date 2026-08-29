import { describe, expect, test } from "vitest";
import { KookWebhookReceiver } from "./webhook.js";

describe("KOOK Webhook receiver", () => {
    test("ingest 返回结构化响应并按 sn 去重", () => {
        const receiver = new KookWebhookReceiver({ verify_token: "verify" });
        const raw = eventSignal(42);
        expect(receiver.ingest(raw)).toMatchObject({
            status: 200,
            body: { success: true },
            event: { msg_id: "message" },
        });
        expect(receiver.ingest(raw)).toEqual({
            status: 200,
            body: { success: true, duplicate: true },
        });
    });

    test("acceptHttp 可直接接收标准 Request", async () => {
        const receiver = new KookWebhookReceiver({ verify_token: "verify" });
        const response = await receiver.acceptHttp(
            new Request("https://example.test/kook", {
                method: "POST",
                body: JSON.stringify(eventSignal(1)),
                headers: { "content-type": "application/json" },
            }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true });
    });

    test("错误响应不泄漏 verify token", async () => {
        const receiver = new KookWebhookReceiver({ verify_token: "super-secret" });
        const response = await receiver.acceptHttp(
            new Request("https://example.test/kook", {
                method: "POST",
                body: "not-json",
            }),
        );
        expect(response.status).toBe(400);
        expect(await response.text()).not.toContain("super-secret");
    });

    test("拒绝非 POST 请求", async () => {
        const receiver = new KookWebhookReceiver({});
        const response = await receiver.acceptHttp(new Request("https://example.test/kook"));
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("POST");
    });
});

function eventSignal(sn: number): Record<string, unknown> {
    return {
        s: 0,
        sn,
        d: {
            type: 9,
            channel_type: "GROUP",
            target_id: "channel",
            author_id: "user",
            content: "hello",
            msg_id: "message",
            msg_timestamp: Date.now(),
            verify_token: "verify",
            extra: {},
        },
    };
}
