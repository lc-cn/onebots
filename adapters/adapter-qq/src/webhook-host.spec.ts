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

    it("复用外部 HTTP Host 并同步补发 SDK 未投影的原始事件", async () => {
        const onDispatch = vi.fn();
        const host = new QQWebhookHost("/qq/test/webhook", "test", onDispatch);
        await host.listen(0, "/ignored", async () => ({ status: 200, body: '{"op":12,"d":0}' }));
        const response = await host.ingest({
            body: Buffer.from(JSON.stringify({ op: 0, t: "FRIEND_ADD", d: { id: "e1" } })),
            headers: {},
        });
        expect(response.status).toBe(200);
        expect(onDispatch).toHaveBeenCalledWith({
            action: "raw",
            type: "FRIEND_ADD",
            data: { id: "e1" },
        });
    });

    it("补齐官方 Webhook 内部会忽略的频道消息", async () => {
        const onDispatch = vi.fn();
        const host = new QQWebhookHost("/qq/test/webhook", "test", onDispatch);
        await host.listen(0, "/ignored", async () => ({ status: 200, body: '{"op":12}' }));
        await host.ingest({
            body: Buffer.from(
                JSON.stringify({
                    op: 0,
                    t: "AT_MESSAGE_CREATE",
                    d: {
                        id: "m1",
                        content: "hello",
                        timestamp: "2026-08-30T00:00:00Z",
                        channel_id: "c1",
                        guild_id: "g1",
                        author: { id: "u1", username: "Alice" },
                    },
                }),
            ),
            headers: {},
        });

        expect(onDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                action: "message",
                msg: expect.objectContaining({ kind: "guild", messageId: "m1" }),
            }),
        );
    });

    it("业务失败不确认，重投成功后才按内容哈希去重", async () => {
        let attempts = 0;
        const onDispatch = vi.fn(async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("consumer failed");
        });
        const host = new QQWebhookHost("/qq/test/webhook", "test", onDispatch);
        await host.listen(0, "/ignored", async () => ({ status: 200, body: '{"op":12}' }));
        const request = {
            body: Buffer.from(JSON.stringify({ op: 0, t: "FRIEND_ADD", d: { id: "e2" } })),
            headers: {},
        };

        await expect(host.ingest(request)).rejects.toThrow("consumer failed");
        await expect(host.ingest(request)).resolves.toMatchObject({ status: 200 });
        await expect(host.ingest(request)).resolves.toMatchObject({ status: 200 });
        expect(onDispatch).toHaveBeenCalledTimes(2);
    });

    it("HTTP Host 将业务投递错误报告为 500", async () => {
        const host = new QQWebhookHost("/qq/test/webhook", "test", async () => {
            throw new Error("consumer failed");
        });
        await host.listen(0, "/ignored", async () => ({ status: 200, body: '{"op":12}' }));
        const body = Buffer.from(JSON.stringify({ op: 0, t: "FRIEND_ADD", d: { id: "e3" } }));
        const context = {
            request: { rawBody: body },
            headers: {},
            status: 0,
            body: undefined as unknown,
            type: "",
            set: vi.fn(),
        };

        await host.acceptHttp(context);

        expect(context.status).toBe(500);
        expect(context.body).toContain("QQ_WEBHOOK_ERROR");
    });

    it("标准 Request 与 Koa 入口复用同一 SDK 验签和业务投递", async () => {
        let release: (() => void) | undefined;
        const delivered = new Promise<void>(resolve => (release = resolve));
        const onDispatch = vi.fn(() => delivered);
        const host = new QQWebhookHost("/qq/test/webhook", "test", onDispatch);
        await host.listen(0, "/ignored", async () => ({
            status: 200,
            headers: { "x-qq-test": "ok" },
            body: '{"op":12,"d":0}',
        }));
        const body = JSON.stringify({ op: 0, t: "FRIEND_ADD", d: { id: "e4" } });

        const pending = host.acceptHttp(
            new Request("https://example.test/qq/test/webhook", {
                method: "POST",
                body,
            }),
        );
        await vi.waitFor(() => expect(onDispatch).toHaveBeenCalledOnce());
        let settled = false;
        void pending.then(() => (settled = true));
        await Promise.resolve();
        expect(settled).toBe(false);
        release?.();

        const response = await pending;
        expect(response.status).toBe(200);
        expect(response.headers.get("x-qq-test")).toBe("ok");
        expect(await response.json()).toEqual({ op: 12, d: 0 });
    });

    it("标准 Request 拒绝非 POST 方法", async () => {
        const host = new QQWebhookHost("/qq/test/webhook", "test", vi.fn());
        const response = await host.acceptHttp(new Request("https://example.test/qq"));
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("POST");
    });
});
