import { beforeEach, describe, expect, it } from "vitest";
import {
    AdapterRegistry,
    ProtocolRegistry,
    type Adapter,
    type Protocol,
    type Schema,
} from "@onebots/core";
import {
    formatRuntimeConfigDiagnostic,
    parseRuntimeConfig,
    validateAccountConfigCandidate,
    validateRuntimeConfig,
} from "./runtime-config-validator.js";

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

    it("将多行 YAML 诊断收敛为不含源码片段的有限首行", () => {
        let error: unknown;
        try {
            parseRuntimeConfig("access_token: secret-never-return\nplugins: [\n");
        } catch (caught) {
            error = caught;
        }

        const diagnostic = formatRuntimeConfigDiagnostic(error);
        expect(diagnostic).toContain("YAML 解析失败");
        expect(diagnostic).not.toContain("secret-never-return");
        expect(diagnostic).not.toContain("plugins: [");
        expect(diagnostic).not.toContain("\n");
        expect(formatRuntimeConfigDiagnostic(new Error("x".repeat(1_100)))).toHaveLength(1_000);
    });

    it("validates persisted plugin selections before startup", () => {
        expect(() =>
            validateRuntimeConfig({
                plugins: { adapters: ["mock"], protocols: "onebot-v11" },
            }),
        ).toThrow(/plugins\.protocols 必须是字符串数组/);
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

    it("使用完整运行时 Schema 校验单账号候选且不改写当前配置", () => {
        registerTestPlugins();
        const current = {
            general: { "test.v1": { use_http: true } },
            "mock.old": { token: "old", "test.v1": {} },
        };

        expect(() =>
            validateAccountConfigCandidate(current, "mock.next", {
                account_id: "next",
                "test.v1": {},
            }),
        ).toThrow(/mock\.next\.token.*required/);
        expect(current).toEqual({
            general: { "test.v1": { use_http: true } },
            "mock.old": { token: "old", "test.v1": {} },
        });

        expect(() =>
            validateAccountConfigCandidate(current, "mock.next", {
                account_id: "next",
                token: "secret",
                "test.v1": {},
            }),
        ).not.toThrow();
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
