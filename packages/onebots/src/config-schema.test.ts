import { beforeEach, describe, expect, test } from "vitest";
import {
    AdapterRegistry,
    ProtocolRegistry,
    assertSchemaFormContract,
    type Schema,
} from "@onebots/core";
import { getAppConfigSchema } from "./config-schema.js";

const adapterSchema: Schema = {
    token: {
        type: "string",
        label: "Token",
        sensitive: true,
        ui: { section: "credentials" },
    },
};

const protocolSchema: Schema = {
    use_http: {
        type: "boolean",
        label: "启用 HTTP",
        ui: { section: "transport" },
    },
};

describe("application config schema", () => {
    beforeEach(() => {
        AdapterRegistry.clear();
        ProtocolRegistry.clear();
    });

    test("基础配置遵守统一表单契约", () => {
        const schema = getAppConfigSchema().base;
        expect(() => assertSchemaFormContract(schema)).not.toThrow();
        expect(schema).toMatchObject({
            plugins: {
                adapters: {
                    type: "array",
                    allowCustomValues: true,
                    ui: { widget: "choice-list" },
                },
                protocols: {
                    type: "array",
                    allowCustomValues: true,
                    ui: { widget: "choice-list" },
                },
            },
        });
    });

    test("将已验证运行时插件作为开放列表建议而不是封闭白名单", () => {
        const schema = getAppConfigSchema([
            {
                type: "adapter",
                name: "mock",
                packageName: "@onebots/adapter-mock",
                version: "1.0.17",
                entryPath: "/runtime/mock.js",
            },
            {
                type: "protocol",
                name: "onebot-v11",
                packageName: "@onebots/protocol-onebot-v11",
                version: null,
                entryPath: "/runtime/onebot-v11.js",
            },
        ]).base;

        expect(schema.plugins).toMatchObject({
            adapters: {
                choices: [
                    {
                        value: "mock",
                        label: "mock · @onebots/adapter-mock@1.0.17",
                    },
                ],
            },
            protocols: {
                choices: [
                    {
                        value: "onebot-v11",
                        label: "onebot-v11 · @onebots/protocol-onebot-v11",
                    },
                ],
            },
        });
    });

    test("只发布已加载插件注册的 Schema", () => {
        AdapterRegistry.registerSchema("example", adapterSchema);
        ProtocolRegistry.registerSchema("example.v1", protocolSchema);

        const schema = getAppConfigSchema();

        expect(schema.adapters).toEqual({ example: adapterSchema });
        expect(schema.protocols).toEqual({ "example.v1": protocolSchema });
        expect(schema.general).toEqual(schema.protocols);
    });

    test("没有插件注册时不伪造可配置项", () => {
        const schema = getAppConfigSchema();

        expect(schema.adapters).toEqual({});
        expect(schema.protocols).toEqual({});
        expect(schema.general).toEqual({});
    });
});
