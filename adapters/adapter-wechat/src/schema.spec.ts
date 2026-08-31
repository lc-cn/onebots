import { describe, expect, it } from "vitest";
import { wechatSchema } from "./index.js";

describe("微信公众号配置 Schema", () => {
    it("按接收模式动态展示 Webhook 字段", () => {
        expect(wechatSchema.receive_mode?.choices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ value: "webhook" }),
                expect.objectContaining({ value: "manual" }),
            ]),
        );
        expect(wechatSchema.token?.required).not.toBe(true);
        expect(wechatSchema.token?.ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook"],
        });
        expect(wechatSchema.webhook_path?.ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook"],
        });
    });

    it("约束 Webhook 路径和 API HTTPS 入口", () => {
        expect(wechatSchema.webhook_path?.pattern).toBeInstanceOf(RegExp);
        expect(wechatSchema.api_base_url?.pattern).toBeInstanceOf(RegExp);
    });
});
