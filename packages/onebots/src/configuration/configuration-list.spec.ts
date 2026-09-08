import { describe, expect, it } from "vitest";
import { editConfigurationList } from "./configuration-list.js";
import { normalizeConfigurationSchema } from "./configuration-schema.js";

const list = {
    type: "array",
    items: {
        type: "object",
        properties: {
            name: { type: "string" },
            token: { type: "string", sensitive: true },
        },
    },
};
const bundle = normalizeConfigurationSchema({
    schemas: {
        schemaVersion: 1,
        adapters: {
            mock: {
                nested: { type: "object", properties: { servers: list } },
                hidden: { ...list, sensitive: true },
                opaque: { type: "object", sensitive: true, properties: { servers: list } },
                uiRows: {
                    type: "array",
                    ui: {
                        fields: [
                            { key: "url", type: "string" },
                            { key: "token", sensitive: true },
                        ],
                    },
                },
            },
        },
        protocols: {},
        applications: {},
    },
    protocols: [],
});
const target = ["mock.001.with.dot", "nested", "servers"];

describe("声明式配置列表行操作", () => {
    it("空列表追加只创建空对象，保留账号ID和其他字段，不生成默认值", () => {
        const document = { "mock.001.with.dot": { untouched: "private" } };
        const result = editConfigurationList(bundle, document, { path: target, action: "append" });
        expect(result).toEqual({
            "mock.001.with.dot": { untouched: "private", nested: { servers: [{}] } },
        });
        expect(document).toEqual({ "mock.001.with.dot": { untouched: "private" } });
    });
    it("删除前一行时后续密钥完整移动，拒绝越界索引且不修改原件", () => {
        const document = {
            "mock.001.with.dot": {
                nested: {
                    servers: [
                        { name: "first", token: "secret-one" },
                        { name: "second", token: "secret-two" },
                    ],
                },
            },
        };
        expect(
            editConfigurationList(bundle, document, { path: target, action: "remove", index: 0 }),
        ).toEqual({
            "mock.001.with.dot": { nested: { servers: [{ name: "second", token: "secret-two" }] } },
        });
        for (const index of [-1, 2, 0.5, Number.MAX_SAFE_INTEGER])
            expect(() =>
                editConfigurationList(bundle, document, { path: target, action: "remove", index }),
            ).toThrow();
        expect(document["mock.001.with.dot"].nested.servers).toHaveLength(2);
    });
    it("拒绝未知字段、整表敏感及敏感祖先，不借行操作删除未声明秘密", () => {
        for (const path of [
            ["mock.001.with.dot", "hidden"],
            ["mock.001.with.dot", "opaque", "servers"],
            ["mock.001.with.dot", "unknown"],
        ])
            expect(() =>
                editConfigurationList(
                    bundle,
                    { "mock.001.with.dot": {} },
                    { path, action: "append" },
                ),
            ).toThrow();
        expect(() =>
            editConfigurationList(
                bundle,
                { "mock.001.with.dot": { nested: { servers: [{ extra: "unknown-secret" }] } } },
                { path: target, action: "remove", index: 0 },
            ),
        ).toThrow();
        expect(() =>
            editConfigurationList(bundle, {}, { path: target, action: "append" }),
        ).toThrow();
    });
    it("ui.fields对象列表能追加，primitive列表和伪造请求被拒绝", () => {
        expect(
            editConfigurationList(
                bundle,
                { "mock.001.with.dot": {} },
                { path: ["mock.001.with.dot", "uiRows"], action: "append" },
            ),
        ).toEqual({ "mock.001.with.dot": { uiRows: [{}] } });
        expect(() =>
            editConfigurationList(
                bundle,
                { plugins: { adapters: [] } },
                { path: ["plugins", "adapters"], action: "append" },
            ),
        ).toThrow();
        expect(() =>
            editConfigurationList(
                bundle,
                { "mock.001.with.dot": {} },
                { path: target, action: "append", index: 0 },
            ),
        ).toThrow();
    });
});
