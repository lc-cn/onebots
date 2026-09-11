import { describe, expect, it } from "vitest";
import { prepareConfigurationContainers } from "./configuration-containers.js";
import { normalizeConfigurationSchema } from "./configuration-schema.js";
const bundle = () =>
    normalizeConfigurationSchema({
        schemas: {
            schemaVersion: 1,
            adapters: {
                qq: {
                    auth: { token: { type: "string", sensitive: true } },
                    other: { value: { type: "string", default: "never" } },
                    nested: {
                        type: "object",
                        properties: {
                            auth: {
                                type: "object",
                                properties: { token: { type: "string", sensitive: true } },
                            },
                        },
                    },
                    rows: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: { auth: { token: { type: "string", sensitive: true } } },
                        },
                    },
                    legacy: { type: "array", ui: { fields: [{ key: "token", sensitive: true }] } },
                },
            },
            protocols: { wire: { auth: { token: { type: "string", sensitive: true } } } },
            applications: {},
        },
        protocols: [{ registrationName: "wire", name: "custom", version: "v1" }],
    });
describe("配置显式字段父容器", () => {
    it("只为本次字段创建声明的对象，不填secret或默认，不碰兄弟", () => {
        const doc = { "qq.account.with.dots": { sibling: { token: "private" } } };
        const result = prepareConfigurationContainers(bundle(), doc, [
            ["qq.account.with.dots", "auth", "token"],
        ]);
        expect(result).toEqual({
            "qq.account.with.dots": { sibling: { token: "private" }, auth: {} },
        });
        expect(doc).toEqual({ "qq.account.with.dots": { sibling: { token: "private" } } });
    });
    it("支持properties多层嵌套、已启用general协议和plugins", () => {
        const schema = bundle();
        schema.base.plugins = { custom: { option: { type: "string" } } };
        const result = prepareConfigurationContainers(
            schema,
            { "qq.a": {}, general: { "custom.v1": {} }, plugins: {} },
            [
                ["qq.a", "nested", "auth", "token"],
                ["general", "custom.v1", "auth", "token"],
                ["plugins", "custom", "option"],
            ],
        );
        expect(result).toEqual({
            "qq.a": { nested: { auth: {} } },
            general: { "custom.v1": { auth: {} } },
            plugins: { custom: {} },
        });
    });
    it("不能隐式创建账号、general、协议或plugins", () => {
        for (const [doc, paths] of [
            [{}, [["qq.a", "auth", "token"]]],
            [{}, [["general", "custom.v1", "auth", "token"]]],
            [{ general: {} }, [["general", "custom.v1", "auth", "token"]]],
            [{ "qq.a": {} }, [["qq.a", "custom.v1", "auth", "token"]]],
            [{}, [["plugins", "adapters"]]],
        ] as const)
            expect(() =>
                prepareConfigurationContainers(
                    bundle(),
                    doc,
                    paths.map(p => [...p]),
                ),
            ).toThrow();
    });
    it("只遍历既存数组索引，支持items和旧ui.fields，不追加行", () => {
        const doc = { "qq.a": { rows: [{}], legacy: [{}] } };
        expect(
            prepareConfigurationContainers(bundle(), doc, [
                ["qq.a", "rows", "0", "auth", "token"],
                ["qq.a", "legacy", "0", "token"],
            ]),
        ).toEqual({ "qq.a": { rows: [{ auth: {} }], legacy: [{}] } });
        for (const index of ["1", "01", "-1"])
            expect(() =>
                prepareConfigurationContainers(bundle(), doc, [
                    ["qq.a", "rows", index, "auth", "token"],
                ]),
            ).toThrow();
        expect(() =>
            prepareConfigurationContainers(bundle(), { "qq.a": {} }, [
                ["qq.a", "rows", "0", "auth", "token"],
            ]),
        ).toThrow();
    });
    it("拒绝未知路径、primitive父值及getter，且失败不修改原文档", () => {
        const doc = { "qq.a": { auth: "wrong" } };
        expect(() =>
            prepareConfigurationContainers(bundle(), doc, [["qq.a", "auth", "token"]]),
        ).toThrow();
        expect(() =>
            prepareConfigurationContainers(bundle(), { "qq.a": {} }, [
                ["qq.a", "unknown", "token"],
            ]),
        ).toThrow();
        expect(() =>
            prepareConfigurationContainers(bundle(), { "qq.a": {} }, [
                ["qq.a", "__proto__", "token"],
            ]),
        ).toThrow();
        let called = false;
        expect(() =>
            prepareConfigurationContainers(
                bundle(),
                {
                    get hidden() {
                        called = true;
                        return "secret";
                    },
                },
                [],
            ),
        ).toThrow();
        expect(called).toBe(false);
        expect(doc).toEqual({ "qq.a": { auth: "wrong" } });
    });
});
