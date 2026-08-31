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
                adapters: { type: "array" },
                protocols: { type: "array" },
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
