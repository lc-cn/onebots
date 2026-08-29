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
    });
});
