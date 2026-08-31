import { afterEach, describe, expect, it } from "vitest";
import { Adapter, Protocol } from "./index.js";
import { ValidationError } from "./errors.js";
import {
    AdapterRegistry,
    ProtocolRegistry,
    captureExtensionRegistryState,
    restoreExtensionRegistryState,
} from "./registry.js";
import { ConfigValidator, type Schema, type ValidationRule } from "./config-validator.js";
import { defineAdapterCapabilities } from "./adapter-capability.js";
import type { BaseApp } from "./base-app.js";

const schema: Schema = {};
const anotherSchema: Schema = {
    enabled: {
        type: "boolean",
        label: "启用",
        ui: { section: "advanced" },
    },
};

const adapterFactory = (() => undefined) as unknown as Adapter.Factory;
const anotherAdapterFactory = (() => undefined) as unknown as Adapter.Factory;
const protocolFactory = (() => undefined) as unknown as Protocol.Factory;
const anotherProtocolFactory = (() => undefined) as unknown as Protocol.Factory;

describe("extension registries", () => {
    afterEach(() => {
        AdapterRegistry.clear();
        ProtocolRegistry.clear();
    });

    it("keeps repeated adapter registration with the same factory idempotent", () => {
        AdapterRegistry.register("mock", adapterFactory, { displayName: "Mock" });

        AdapterRegistry.register("mock", adapterFactory, { displayName: "Ignored" });

        expect(AdapterRegistry.get("mock")).toBe(adapterFactory);
        expect(AdapterRegistry.getMetadata("mock")?.displayName).toBe("Mock");
    });

    it("rejects a different adapter factory using an occupied name", () => {
        AdapterRegistry.register("mock", adapterFactory);

        expect(() => AdapterRegistry.register("mock", anotherAdapterFactory)).toThrowError(
            ValidationError,
        );
        expect(AdapterRegistry.get("mock")).toBe(adapterFactory);
    });

    it("rejects malformed adapter capabilities before mutating the registry", () => {
        expect(() =>
            AdapterRegistry.register("broken", adapterFactory, {
                capabilities: {
                    version: 1,
                    actions: {},
                    events: {},
                    segments: { text: { support: "native" } },
                    transports: {},
                } as never,
            }),
        ).toThrow("direction 无效");
        expect(AdapterRegistry.has("broken")).toBe(false);
        expect(AdapterRegistry.getMetadata("broken")).toBeUndefined();
    });

    it("stores an immutable capability snapshot instead of caller-owned metadata", () => {
        const capabilities = {
            version: 1,
            actions: { ping: { support: "native" } },
            events: {},
            segments: {},
            transports: {},
        };

        AdapterRegistry.register("mock", adapterFactory, { capabilities: capabilities as never });
        capabilities.actions.ping.support = "unsupported";

        const registered = AdapterRegistry.getMetadata("mock")?.capabilities;
        expect(registered?.actions.ping.support).toBe("native");
        expect(Object.isFrozen(registered)).toBe(true);
        expect(Object.isFrozen(registered?.actions.ping)).toBe(true);
    });

    it("keeps adapter metadata immutable through direct and bulk reads", () => {
        AdapterRegistry.register("mock", adapterFactory, {
            displayName: "Mock",
            description: "测试适配器",
            homepage: "https://example.com",
        });
        const registered = AdapterRegistry.getMetadata("mock")!;

        expect(AdapterRegistry.getAllMetadata()[0]).toBe(registered);
        expect(Object.isFrozen(registered)).toBe(true);
        expect(() => {
            registered.displayName = "运行时篡改";
        }).toThrow(TypeError);
        expect(AdapterRegistry.getMetadata("mock")?.displayName).toBe("Mock");
    });

    it("rejects an adapter instance whose default capabilities differ from registration", () => {
        const registeredCapabilities = defineAdapterCapabilities({
            actions: { ping: { support: "native" } },
            events: {},
            segments: {},
            transports: {},
        });
        const runtimeCapabilities = defineAdapterCapabilities({
            actions: { ping: { support: "unsupported" } },
            events: {},
            segments: {},
            transports: {},
        });
        const factory = (() => ({
            describeCapabilities: () => runtimeCapabilities,
            isActionImplemented: () => true,
        })) as unknown as Adapter.Factory;
        AdapterRegistry.register("drifted", factory, { capabilities: registeredCapabilities });

        expect(() => AdapterRegistry.create("drifted", {} as BaseApp)).toThrow(
            "注册能力清单与实例默认能力不一致",
        );
    });

    it("validates advertised action implementations when creating an adapter", () => {
        const capabilities = defineAdapterCapabilities({
            actions: { ping: { support: "native" } },
            events: {},
            segments: {},
            transports: {},
        });
        const factory = (() => ({
            describeCapabilities: () => capabilities,
            isActionImplemented: () => false,
        })) as unknown as Adapter.Factory;
        AdapterRegistry.register("incomplete", factory, { capabilities });

        expect(() => AdapterRegistry.create("incomplete", {} as BaseApp)).toThrow(
            "适配器能力清单声明了未实现动作: ping",
        );
    });

    it("keeps repeated protocol registration with the same factory idempotent", () => {
        ProtocolRegistry.register("test", "v1", protocolFactory, { displayName: "Test" });

        ProtocolRegistry.register("test", "v1", protocolFactory, { displayName: "Ignored" });

        expect(ProtocolRegistry.get("test", "v1")).toBe(protocolFactory);
        expect(ProtocolRegistry.getMetadata("test")?.displayName).toBe("Test");
    });

    it("updates immutable protocol version metadata with copy-on-write", () => {
        ProtocolRegistry.register("test", "v1", protocolFactory, { displayName: "Test" });
        const first = ProtocolRegistry.getMetadata("test")!;

        expect(Object.isFrozen(first)).toBe(true);
        expect(Object.isFrozen(first.versions)).toBe(true);
        expect(() => first.versions.push("hidden")).toThrow(TypeError);

        ProtocolRegistry.register("test", "v2", anotherProtocolFactory);
        const second = ProtocolRegistry.getMetadata("test")!;
        expect(second).not.toBe(first);
        expect(first.versions).toEqual(["v1"]);
        expect(second.versions).toEqual(["v1", "v2"]);
        expect(Object.isFrozen(second.versions)).toBe(true);

        ProtocolRegistry.unregister("test", "v1");
        expect(ProtocolRegistry.getMetadata("test")?.versions).toEqual(["v2"]);
        expect(Object.isFrozen(ProtocolRegistry.getMetadata("test")?.versions)).toBe(true);
    });

    it("rejects a different protocol factory using an occupied name and version", () => {
        ProtocolRegistry.register("test", "v1", protocolFactory);

        expect(() => ProtocolRegistry.register("test", "v1", anotherProtocolFactory)).toThrowError(
            ValidationError,
        );
        expect(ProtocolRegistry.get("test", "v1")).toBe(protocolFactory);
    });

    it("keeps repeated schema registration with the same object idempotent", () => {
        AdapterRegistry.registerSchema("mock", schema);
        ProtocolRegistry.registerSchema("test.v1", schema);

        expect(() => AdapterRegistry.registerSchema("mock", schema)).not.toThrow();
        expect(() => ProtocolRegistry.registerSchema("test.v1", schema)).not.toThrow();
    });

    it("rejects schema replacement and preserves the original contract", () => {
        AdapterRegistry.registerSchema("mock", schema);
        ProtocolRegistry.registerSchema("test.v1", schema);
        const adapterSnapshot = AdapterRegistry.getSchema("mock");
        const protocolSnapshot = ProtocolRegistry.getSchema("test.v1");

        expect(() => AdapterRegistry.registerSchema("mock", anotherSchema)).toThrowError(
            ValidationError,
        );
        expect(() => ProtocolRegistry.registerSchema("test.v1", anotherSchema)).toThrowError(
            ValidationError,
        );
        expect(adapterSnapshot).not.toBe(schema);
        expect(protocolSnapshot).not.toBe(schema);
        expect(AdapterRegistry.getSchema("mock")).toBe(adapterSnapshot);
        expect(ProtocolRegistry.getSchema("test.v1")).toBe(protocolSnapshot);
    });

    it("stores an immutable schema snapshot and clones container defaults for each config", () => {
        const mutableSchema: Schema = {
            endpoint: {
                required: true,
                type: "string",
                default: "https://example.com",
                pattern: /^https:\/\//u,
                label: "端点",
                ui: { section: "transport" },
            },
            scopes: {
                required: true,
                type: "array",
                default: ["messages"],
                label: "权限",
                ui: { section: "transport" },
            },
        };
        const sourceEndpointRule = mutableSchema.endpoint as ValidationRule<string>;
        const sourceScopesRule = mutableSchema.scopes as ValidationRule<string[]>;
        AdapterRegistry.registerSchema("immutable", mutableSchema);
        const registered = AdapterRegistry.getSchema("immutable")!;
        const registeredEndpointRule = registered.endpoint as ValidationRule<string>;
        const registeredScopesRule = registered.scopes as ValidationRule<string[]>;
        expect(AdapterRegistry.getAllSchemas().immutable).toBe(registered);

        sourceEndpointRule.label = "已篡改";
        (sourceScopesRule.default as string[]).push("admin");
        expect(registeredEndpointRule.label).toBe("端点");
        expect(registeredScopesRule.default).toEqual(["messages"]);
        expect(registeredEndpointRule.pattern).not.toBe(sourceEndpointRule.pattern);
        expect(Object.isFrozen(registered)).toBe(true);
        expect(Object.isFrozen(registeredEndpointRule)).toBe(true);
        expect(Object.isFrozen(registeredScopesRule.default)).toBe(true);
        expect(() => {
            registeredEndpointRule.label = "运行时篡改";
        }).toThrow(TypeError);

        const first = ConfigValidator.validate<Record<string, unknown>>({}, registered);
        const second = ConfigValidator.validate<Record<string, unknown>>({}, registered);
        expect(first).toEqual({ endpoint: "https://example.com", scopes: ["messages"] });
        expect(Object.isFrozen(first.scopes)).toBe(false);
        expect(first.scopes).not.toBe(second.scopes);
    });

    it("removes related schemas when an extension is unregistered", () => {
        AdapterRegistry.register("mock", adapterFactory);
        AdapterRegistry.registerSchema("mock", schema);
        ProtocolRegistry.register("test", "v1", protocolFactory);
        ProtocolRegistry.registerSchema("test.v1", schema);

        AdapterRegistry.unregister("mock");
        ProtocolRegistry.unregister("test", "v1");

        expect(AdapterRegistry.getSchema("mock")).toBeUndefined();
        expect(ProtocolRegistry.getSchema("test.v1")).toBeUndefined();
    });

    it("restores factories, schemas and protocol version metadata as one state", () => {
        AdapterRegistry.register("existing", adapterFactory, { displayName: "Existing" });
        AdapterRegistry.registerSchema("existing", schema);
        ProtocolRegistry.register("test", "v1", protocolFactory, { displayName: "Test" });
        ProtocolRegistry.registerSchema("test.v1", schema);
        const existingAdapterSchema = AdapterRegistry.getSchema("existing");
        const existingProtocolSchema = ProtocolRegistry.getSchema("test.v1");
        const state = captureExtensionRegistryState();

        AdapterRegistry.unregister("existing");
        AdapterRegistry.register("partial", anotherAdapterFactory);
        AdapterRegistry.registerSchema("partial", anotherSchema);
        ProtocolRegistry.register("test", "v2", anotherProtocolFactory);
        ProtocolRegistry.registerSchema("test.v2", anotherSchema);

        restoreExtensionRegistryState(state);

        expect(AdapterRegistry.get("existing")).toBe(adapterFactory);
        expect(AdapterRegistry.getMetadata("existing")?.displayName).toBe("Existing");
        expect(AdapterRegistry.getSchema("existing")).toBe(existingAdapterSchema);
        expect(AdapterRegistry.has("partial")).toBe(false);
        expect(AdapterRegistry.getSchema("partial")).toBeUndefined();
        expect(ProtocolRegistry.get("test", "v1")).toBe(protocolFactory);
        expect(ProtocolRegistry.getSchema("test.v1")).toBe(existingProtocolSchema);
        expect(ProtocolRegistry.has("test", "v2")).toBe(false);
        expect(ProtocolRegistry.getSchema("test.v2")).toBeUndefined();
        expect(ProtocolRegistry.getMetadata("test")?.versions).toEqual(["v1"]);
    });
});
