import { describe, expect, it } from "vitest";
import { assertSchemaFormContract, type Schema } from "./config-validator.js";

const validSchema: Schema = {
    receive_mode: {
        type: "string",
        label: "接收方式",
        choices: [{ label: "Webhook", value: "webhook" }],
        ui: { section: "transport" },
    },
    access_token: {
        type: "string",
        label: "访问令牌",
        sensitive: true,
        ui: { section: "credentials" },
    },
    webhook_urls: {
        type: "array",
        label: "Webhook 地址",
        ui: {
            section: "delivery",
            widget: "endpoint-list",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
};

describe("schema form contract", () => {
    it("接受闭合的表单 Schema", () => {
        expect(() => assertSchemaFormContract(validSchema)).not.toThrow();
    });

    it("拒绝缺少分区、悬空依赖和未保护的敏感字段", () => {
        expect(() =>
            assertSchemaFormContract({ name: { type: "string", label: "名称" } }),
        ).toThrow("ui.section");
        expect(() =>
            assertSchemaFormContract({
                endpoint: {
                    type: "string",
                    label: "地址",
                    ui: {
                        section: "delivery",
                        visibleWhen: { path: "missing", oneOf: [true] },
                    },
                },
            }),
        ).toThrow("不存在的显示依赖");
        expect(() =>
            assertSchemaFormContract({
                access_token: {
                    type: "string",
                    label: "访问令牌",
                    ui: { section: "credentials" },
                },
            }),
        ).toThrow("sensitive");
    });
});
