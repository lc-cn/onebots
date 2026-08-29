import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCategory } from "onebots";
import { DingTalkError } from "./errors.js";
import { buildSignedWebhookUrl } from "./webhook-url.js";

describe("buildSignedWebhookUrl", () => {
    afterEach(() => vi.restoreAllMocks());

    it("构造钉钉自定义机器人签名参数", () => {
        vi.spyOn(Date, "now").mockReturnValue(1710000000000);

        const url = new URL(
            buildSignedWebhookUrl({
                account_id: "bot",
                webhook_url: "https://oapi.dingtalk.com/robot/send?access_token=token",
                webhook_secret: "SEC-test",
            }),
        );

        expect(url.searchParams.get("timestamp")).toBe("1710000000000");
        expect(url.searchParams.get("sign")).toBeTruthy();
    });

    it("在请求前拒绝不安全的 Webhook 地址", () => {
        let error: unknown;
        try {
            buildSignedWebhookUrl({
                account_id: "bot",
                webhook_url: "http://oapi.dingtalk.com/robot/send",
            });
        } catch (reason) {
            error = reason;
        }

        expect(error).toBeInstanceOf(DingTalkError);
        expect(error).toMatchObject({
            code: "DINGTALK_WEBHOOK_URL_UNSAFE",
            category: ErrorCategory.CONFIG,
        });
    });
});
