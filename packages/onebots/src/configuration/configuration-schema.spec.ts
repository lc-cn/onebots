import { describe, expect, it } from "vitest";
import { normalizeConfigurationSchema, inspectConfigurationPaths } from "./configuration-schema.js";
import { projectConfiguration } from "./configuration-document.js";

const schema = () =>
    normalizeConfigurationSchema({
        schemas: {
            schemaVersion: 1,
            adapters: {
                qq: {
                    nickname: { type: "string" },
                    password: { type: "string", sensitive: true },
                    nested: { secret: { type: "string", sensitive: true } },
                    rows: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                name: { type: "string" },
                                token: { type: "string", sensitive: true },
                            },
                        },
                    },
                    webhooks: {
                        type: "array",
                        ui: {
                            fields: [
                                { key: "url", type: "string" },
                                { key: "token", sensitive: true },
                            ],
                        },
                    },
                    opaque: { type: "object" },
                },
            },
            protocols: { "custom-output": { access_token: { type: "string", sensitive: true } } },
            applications: { zhin: { name: "zhin", displayName: "Zhin" } },
        },
        protocols: [{ registrationName: "custom-output", name: "onebot", version: "v11" }],
    });

describe("可信配置 Schema 投影", () => {
    it("只按已验证 metadata 映射，不猜注册名；框架不强制协议", () => {
        const result = schema();
        expect(Object.keys(result.protocols)).toEqual(["onebot.v11"]);
        expect(result.general).toEqual(result.protocols);
        expect(result.applications.zhin.name).toBe("zhin");
        for (const key of ["port", "username", "password", "access_token"])
            expect(result.base).not.toHaveProperty(key);
        expect(result.base).toHaveProperty("database");
        expect(result.unknownFieldPolicy).toBe("withhold");
    });
    it("产物缺少映射、映射重名或未知协议一律拒绝", () => {
        const schemas = {
            schemaVersion: 1,
            adapters: {},
            protocols: { "onebot-v11": {} },
            applications: {},
        };
        expect(() => normalizeConfigurationSchema({ schemas, protocols: [] })).toThrow();
        expect(() => normalizeConfigurationSchema({ schemas, protocols: undefined! })).toThrow();
        expect(() =>
            normalizeConfigurationSchema({
                schemas,
                protocols: [{ registrationName: "wrong", name: "onebot", version: "v11" }],
            }),
        ).toThrow();
        expect(() =>
            normalizeConfigurationSchema({
                schemas: { ...schemas, protocols: { a: {}, b: {} } },
                protocols: [
                    { registrationName: "a", name: "onebot", version: "v11" },
                    { registrationName: "b", name: "onebot", version: "v11" },
                ],
            }),
        ).toThrow();
    });
    it("保留完整账号键，保护继承协议、嵌套规则、数组 items 和旧 ui.fields", () => {
        const config = {
            general: { "onebot.v11": { access_token: "general-secret" } },
            "qq.account.with.dots": {
                nickname: "Alice",
                password: "secret",
                nested: { secret: "nested" },
                rows: [{ name: "row", token: "row-secret" }],
                webhooks: [{ url: "https://example.test", token: "hook-secret" }],
                "onebot.v11": { access_token: "account-secret" },
            },
        };
        const result = inspectConfigurationPaths(schema(), config);
        expect(result.unknownPaths).toEqual([]);
        expect(result.sensitivePaths).toHaveLength(6);
        expect(result.sensitivePaths).toContainEqual([
            "qq.account.with.dots",
            "rows",
            "0",
            "token",
        ]);
        const projection = projectConfiguration(config, result.sensitivePaths);
        expect(JSON.stringify(projection.document)).not.toContain("secret");
        expect(JSON.stringify(projection.document)).toContain("Alice");
        expect(config["qq.account.with.dots"].password).toBe("secret");
    });
    it("未知字段与无约束对象整棵隐藏，异常形状不泄漏且不更改私有文档", () => {
        const config = {
            mystery: { token: "hidden" },
            "qq.a": {
                nickname: { unexpected: "hidden" },
                opaque: { token: "hidden" },
                rows: [{ name: "safe", extra: { token: "hidden" } }],
            },
        };
        const result = inspectConfigurationPaths(schema(), config);
        expect(result.unknownPaths).toContainEqual(["mystery"]);
        expect(result.unknownPaths).toContainEqual(["qq.a", "opaque"]);
        expect(result.unknownPaths).toContainEqual(["qq.a", "rows", "0", "extra"]);
        const projected = projectConfiguration(config, result.sensitivePaths);
        expect(JSON.stringify(projected.document)).not.toContain("hidden");
        expect(config.mystery.token).toBe("hidden");
    });
    it("拒绝函数和 getter，不执行声明产物中的代码", () => {
        let called = false;
        const schemas = {
            get adapters() {
                called = true;
                return {};
            },
        };
        expect(() => normalizeConfigurationSchema({ schemas, protocols: [] })).toThrow();
        expect(called).toBe(false);
    });
});
