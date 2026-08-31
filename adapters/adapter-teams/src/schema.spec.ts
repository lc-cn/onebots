import { describe, expect, it } from "vitest";
import { teamsSchema } from "./index.js";

describe("Teams 配置 Schema", () => {
    it("将服务端地址限制为 HTTPS，并用动态列表维护额外 Connector", () => {
        expect(teamsSchema.authority_endpoint.pattern).toBeInstanceOf(RegExp);
        expect(teamsSchema.graph_base_url.pattern).toBeInstanceOf(RegExp);
        expect(teamsSchema.allowed_service_urls).toMatchObject({
            type: "array",
            ui: {
                widget: "endpoint-list",
                schemes: ["https:"],
            },
        });
    });

    it("提供 manual 接入并只在 webhook 模式展示路由", () => {
        const webhookUi = teamsSchema.webhook_path.ui as {
            visibleWhen?: { path: string; oneOf: string[] };
        };

        expect(teamsSchema.receive_mode.choices?.map(choice => choice.value)).toEqual([
            "webhook",
            "manual",
        ]);
        expect(webhookUi.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook"],
        });
    });
});
