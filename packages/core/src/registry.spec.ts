import { afterEach, describe, expect, it } from "vitest";
import { Adapter, Protocol } from "./index.js";
import { ValidationError } from "./errors.js";
import { AdapterRegistry, ProtocolRegistry } from "./registry.js";
import type { Schema } from "./config-validator.js";

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

    it("keeps repeated protocol registration with the same factory idempotent", () => {
        ProtocolRegistry.register("test", "v1", protocolFactory, { displayName: "Test" });

        ProtocolRegistry.register("test", "v1", protocolFactory, { displayName: "Ignored" });

        expect(ProtocolRegistry.get("test", "v1")).toBe(protocolFactory);
        expect(ProtocolRegistry.getMetadata("test")?.displayName).toBe("Test");
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

        expect(() => AdapterRegistry.registerSchema("mock", anotherSchema)).toThrowError(
            ValidationError,
        );
        expect(() => ProtocolRegistry.registerSchema("test.v1", anotherSchema)).toThrowError(
            ValidationError,
        );
        expect(AdapterRegistry.getSchema("mock")).toBe(schema);
        expect(ProtocolRegistry.getSchema("test.v1")).toBe(schema);
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
});
