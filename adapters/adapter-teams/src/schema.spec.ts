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
});
