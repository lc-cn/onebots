import { describe, expect, it } from "vitest";
import { slackSchema } from "./index.js";

describe("Slack 配置 Schema", () => {
    it("使用互斥接收模式并按模式展示凭据", () => {
        expect(slackSchema.receive_mode).toMatchObject({
            type: "string",
            default: "socket",
            choices: [
                { value: "socket", label: expect.any(String) },
                { value: "webhook", label: expect.any(String) },
                { value: "manual", label: expect.any(String) },
            ],
        });
        expect(slackSchema.app_token.ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["socket"],
        });
        expect(slackSchema.signing_secret.ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook", "manual"],
        });
        expect(slackSchema.socket_mode).toBeUndefined();
        expect(slackSchema.proxy.password).toMatchObject({
            sensitive: true,
            ui: { section: "advanced" },
        });
    });
});
