import { describe, expect, it } from "vitest";
import { WechatClient } from "./client.js";
import type { WechatConfig } from "./types.js";

const base: WechatConfig = {
    account_id: "bot",
    app_id: "wx-app",
    app_secret: "secret",
    receive_mode: "manual",
};

describe("微信公众号配置", () => {
    it("manual 模式无需 Webhook 凭据", () => {
        const client = new WechatClient(base);
        expect(client.receiveMode).toBe("manual");
    });

    it("webhook 模式必须提供 token", () => {
        expect(() => new WechatClient({ ...base, receive_mode: "webhook" })).toThrowError(
            expect.objectContaining({ code: "WECHAT_WEBHOOK_CONFIG_REQUIRED" }),
        );
    });

    it("在建立请求前拒绝非法数值配置", () => {
        expect(() => new WechatClient({ ...base, passive_reply_timeout_ms: 4_501 })).toThrowError(
            expect.objectContaining({ code: "WECHAT_INVALID_PASSIVE_REPLY_TIMEOUT" }),
        );
        expect(() => new WechatClient({ ...base, webhook_deduplication_limit: 99 })).toThrowError(
            expect.objectContaining({ code: "WECHAT_INVALID_DEDUPLICATION_LIMIT" }),
        );
    });
});
