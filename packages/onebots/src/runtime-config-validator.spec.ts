import { beforeEach, describe, expect, it } from "vitest";
import {
    AdapterRegistry,
    ProtocolRegistry,
    type Adapter,
    type Protocol,
    type Schema,
} from "@onebots/core";
import { parseRuntimeConfig, validateRuntimeConfig } from "./runtime-config-validator.js";

const adapterSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号",
        ui: { section: "credentials" },
    },
    token: {
        type: "string",
        required: true,
        label: "Token",
        sensitive: true,
        ui: { section: "credentials" },
    },
};
const protocolSchema: Schema = {
    use_http: {
        type: "boolean",
        required: true,
        label: "HTTP",
        ui: { section: "transport" },
    },
};

describe("runtime config validation", () => {
    beforeEach(() => {
        AdapterRegistry.clear();
        ProtocolRegistry.clear();
    });

    it("validates adapter credentials and inherited protocol configuration", () => {
        registerTestPlugins();

        expect(() =>
            validateRuntimeConfig({
                port: 6727,
                general: { "test.v1": { use_http: true } },
                "mock.demo": { token: "secret", "test.v1": {} },
            }),
        ).not.toThrow();
    });

    it("rejects malformed YAML and non-object roots before validation", () => {
        expect(() => parseRuntimeConfig("port: [")).toThrow(/YAML 解析失败/);
        expect(() => parseRuntimeConfig("- port\n- 6727")).toThrow(/根节点必须是对象/);
    });

    it("reports precise paths for missing adapter fields and invalid protocol values", () => {
        registerTestPlugins();

        expect(() =>
            validateRuntimeConfig({
                "mock.demo": { "test.v1": { use_http: "yes" } },
            }),
        ).toThrow(/mock\.demo\.token.*required.*mock\.demo\.test\.v1\.use_http.*boolean/);
    });

    it("rejects an account before startup when it has no loaded protocol outlet", () => {
        registerTestPlugins();

        expect(() =>
            validateRuntimeConfig({
                "mock.demo": { token: "secret" },
            }),
        ).toThrow(/mock\.demo.*至少需要配置一个已加载的协议出口/);
    });

    it("rejects configured accounts whose adapter or protocol was not loaded", () => {
        expect(() =>
            validateRuntimeConfig({ general: { "ghost.v1": { use_http: true } } }),
        ).toThrow(/general\.ghost\.v1.*协议 ghost\.v1 未加载/);

        expect(() =>
            validateRuntimeConfig({
                "missing.demo": { "ghost.v1": {} },
            }),
        ).toThrow(/适配器 missing 未加载/);

        AdapterRegistry.register("mock", (() => undefined) as unknown as Adapter.Factory);
        AdapterRegistry.registerSchema("mock", adapterSchema);
        expect(() =>
            validateRuntimeConfig({
                "mock.demo": { token: "secret", "ghost.v1": {} },
            }),
        ).toThrow(/协议 ghost\.v1 未加载.*至少需要配置一个已加载的协议出口/);
    });
});

function registerTestPlugins(): void {
    AdapterRegistry.register("mock", (() => undefined) as unknown as Adapter.Factory);
    AdapterRegistry.registerSchema("mock", adapterSchema);
    ProtocolRegistry.register("test", "v1", (() => undefined) as unknown as Protocol.Factory);
    ProtocolRegistry.registerSchema("test.v1", protocolSchema);
}
