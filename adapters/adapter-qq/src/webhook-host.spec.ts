import { describe, expect, it, vi } from "vitest";
import { QQApiError } from "./errors.js";
import { QQWebhookHost } from "./webhook-host.js";

describe("QQ 共享 Webhook Host", () => {
    it("未启动时返回结构化错误", async () => {
        const host = new QQWebhookHost("/qq/test/webhook", "test", vi.fn());
        await expect(host.ingest({ body: Buffer.from("{}"), headers: {} })).rejects.toBeInstanceOf(
            QQApiError,
        );
    });

    it("复用外部 HTTP Host 并补发 SDK 未投影的原始事件", async () => {
        const onRawEvent = vi.fn();
        const host = new QQWebhookHost("/qq/test/webhook", "test", onRawEvent);
        await host.listen(0, "/ignored", async () => ({ status: 200, body: '{"op":12,"d":0}' }));
        const response = await host.ingest({
            body: Buffer.from(JSON.stringify({ op: 0, t: "FRIEND_ADD", d: { id: "e1" } })),
            headers: {},
        });
        expect(response.status).toBe(200);
        expect(onRawEvent).toHaveBeenCalledWith("FRIEND_ADD", { id: "e1" });
    });
});
