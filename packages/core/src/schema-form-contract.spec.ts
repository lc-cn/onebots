import { describe, expect, it } from "vitest";
import { assertSchemaFormContract, type Schema } from "./config-validator.js";

const validSchema: Schema = {
    receive_mode: {
        type: "string",
        label: "接收方式",
        choices: [{ label: "Webhook", value: "webhook" }],
        ui: {
            section: "transport",
            inferValueFromPresence: [{ path: "access_token", value: "webhook" }],
        },
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
        expect(() =>
            assertSchemaFormContract({
                friends: {
                    type: "array",
                    label: "好友",
                    ui: {
                        section: "advanced",
                        widget: "record-list",
                        fields: [
                            { key: "user_id", label: "用户 ID" },
                            { key: "enabled", label: "启用", type: "boolean" },
                        ],
                    },
                },
            }),
        ).not.toThrow();
    });

    it("拒绝缺少分区、悬空依赖和未保护的敏感字段", () => {
        expect(() => assertSchemaFormContract({ name: { type: "string", label: "名称" } })).toThrow(
            "ui.section",
        );
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
                mode: {
                    type: "string",
                    label: "方式",
                    choices: [{ label: "自动", value: "auto" }],
                    ui: {
                        section: "transport",
                        inferValueFromPresence: [{ path: "missing", value: "auto" }],
                    },
                },
            }),
        ).toThrow("不存在的推断来源");
        expect(() =>
            assertSchemaFormContract({
                access_token: {
                    type: "string",
                    label: "访问令牌",
                    ui: { section: "credentials" },
                },
            }),
        ).toThrow("sensitive");
        expect(() =>
            assertSchemaFormContract({
                endpoints: {
                    type: "array",
                    label: "地址",
                    ui: {
                        section: "delivery",
                        widget: "endpoint-list",
                        fields: [{ key: "access_token", label: "Token" }],
                    },
                },
            }),
        ).toThrow("endpoints.access_token");
        expect(() =>
            assertSchemaFormContract({
                friend: {
                    type: "object",
                    label: "好友",
                    ui: { section: "advanced", widget: "record-list" },
                },
            }),
        ).toThrow("必须使用 array");
    });
});
