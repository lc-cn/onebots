import { ConfigValidator } from "onebots";
import { describe, expect, it } from "vitest";
import { qqSchema } from "./index.js";

describe("QQ 配置 Schema", () => {
    it("提供 manual 接入并只在 webhook 模式显示路由配置", () => {
        const webhookUi = qqSchema.webhook_path.ui as {
            visibleWhen?: { path: string; oneOf: string[] };
        };

        expect(qqSchema.receive_mode.choices).toContainEqual({
            value: "manual",
            label: "手动接入已有 HTTP Host",
        });
        expect(webhookUi.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook"],
        });
        expect(qqSchema.intents.ui).toMatchObject({
            widget: "choice-list",
            section: "filter",
        });
    });

    it("拒绝重复 Intent、绝对外部 Webhook 地址与无协议 API 端点", () => {
        expect(() =>
            ConfigValidator.validate(
                {
                    account_id: "bot",
                    appid: "app",
                    secret: "secret",
                    intents: ["GUILDS", "GUILDS"],
                    webhook_path: "https://example.com/webhook",
                    api_base_url: "api.example.com",
                },
                qqSchema,
            ),
        ).toThrow();
        expect(() =>
            ConfigValidator.validate(
                {
                    account_id: "bot",
                    appid: "app",
                    secret: "secret",
                    intents: ["GUILDS", "INTERACTION"],
                    webhook_path: "/qq/bot/webhook",
                    api_base_url: "https://api.sgroup.qq.com",
                },
                qqSchema,
            ),
        ).not.toThrow();
    });
});
