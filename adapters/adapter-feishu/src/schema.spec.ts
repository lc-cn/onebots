import { describe, expect, it } from "vitest";
import { feishuSchema } from "./index.js";

describe("飞书配置 Schema", () => {
    it("使用统一接收模式并动态显示 Webhook 凭据", () => {
        expect(feishuSchema.receive_mode).toMatchObject({
            type: "string",
            default: "long_connection",
            choices: [
                { value: "long_connection", label: expect.any(String) },
                { value: "webhook", label: expect.any(String) },
                { value: "manual", label: expect.any(String) },
            ],
        });
        expect(feishuSchema.verification_token.ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook", "manual"],
        });
        expect(feishuSchema.encrypt_key.ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook", "manual"],
        });
        expect(feishuSchema).not.toHaveProperty("long_connection");
    });
});
