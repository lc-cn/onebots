import { afterEach, describe, expect, it } from "vitest";
import {
    AdapterRegistry,
    defineAdapterCapabilities,
    EMPTY_ADAPTER_CAPABILITIES,
    type Adapter,
} from "@onebots/core";
import { getAdapterInfo } from "./adapter-info.js";

const factory = (() => undefined) as unknown as Adapter.Factory;

afterEach(() => AdapterRegistry.clear());

describe("adapter management info", () => {
    it("merges registered display metadata into runtime adapter information", () => {
        AdapterRegistry.register("mock", factory, {
            displayName: "模拟平台",
            description: "用于本地验证",
        });
        const adapter = {
            platform: "mock",
            info: {
                platform: "mock",
                icon: "mock.svg",
                capabilities: EMPTY_ADAPTER_CAPABILITIES,
                accounts: [],
            },
            describeCapabilities: () => EMPTY_ADAPTER_CAPABILITIES,
        } as unknown as Pick<Adapter, "describeCapabilities" | "info" | "platform">;

        expect(getAdapterInfo(adapter)).toMatchObject({
            platform: "mock",
            displayName: "模拟平台",
            description: "用于本地验证",
        });
    });

    it("falls back to the platform identifier when metadata is unavailable", () => {
        const adapter = {
            platform: "custom",
            info: {
                platform: "custom",
                icon: "",
                capabilities: EMPTY_ADAPTER_CAPABILITIES,
                accounts: [],
            },
            describeCapabilities: () => EMPTY_ADAPTER_CAPABILITIES,
        } as unknown as Pick<Adapter, "describeCapabilities" | "info" | "platform">;

        expect(getAdapterInfo(adapter)).toMatchObject({
            displayName: "custom",
            description: "",
        });
    });

    it("publishes only account-specific capability overrides", () => {
        const accountCapabilities = defineAdapterCapabilities({
            actions: { send_message: { support: "unsupported", note: "当前账号无发送权限" } },
            events: {},
            segments: {},
            transports: {},
        });
        const adapter = {
            platform: "mock",
            info: {
                platform: "mock",
                icon: "",
                capabilities: EMPTY_ADAPTER_CAPABILITIES,
                accounts: [{ uin: "limited" }, { uin: "default" }],
            },
            describeCapabilities: (accountId?: string) =>
                accountId === "limited" ? accountCapabilities : EMPTY_ADAPTER_CAPABILITIES,
        } as unknown as Pick<Adapter, "describeCapabilities" | "info" | "platform">;

        expect(getAdapterInfo(adapter).accountCapabilities).toEqual({
            limited: accountCapabilities,
        });
    });

    it("omits a separately allocated account manifest with the same semantics", () => {
        const defaultCapabilities = defineAdapterCapabilities({
            actions: { send_message: { support: "native" } },
            events: {},
            segments: {},
            transports: {},
        });
        const equivalentCapabilities = defineAdapterCapabilities({
            actions: { send_message: { support: "native" } },
            events: {},
            segments: {},
            transports: {},
        });
        const adapter = {
            platform: "mock",
            info: {
                platform: "mock",
                icon: "",
                capabilities: defaultCapabilities,
                accounts: [{ uin: "equivalent" }],
            },
            describeCapabilities: () => equivalentCapabilities,
        } as unknown as Pick<Adapter, "describeCapabilities" | "info" | "platform">;

        expect(getAdapterInfo(adapter).accountCapabilities).toEqual({});
    });

    it("validates and snapshots account-specific manifests before publishing them", () => {
        const mutableCapabilities = {
            version: 1,
            actions: { send_message: { support: "native" } },
            events: {},
            segments: {},
            transports: {},
        };
        const adapter = {
            platform: "mock",
            info: {
                platform: "mock",
                icon: "",
                capabilities: EMPTY_ADAPTER_CAPABILITIES,
                accounts: [{ uin: "mutable" }],
            },
            describeCapabilities: () => mutableCapabilities,
        } as unknown as Pick<Adapter, "describeCapabilities" | "info" | "platform">;

        const published = getAdapterInfo(adapter).accountCapabilities.mutable;
        mutableCapabilities.actions.send_message.support = "unsupported";

        expect(published.actions.send_message.support).toBe("native");
        expect(Object.isFrozen(published)).toBe(true);
        expect(Object.isFrozen(published.actions.send_message)).toBe(true);
    });

    it("rejects a malformed account-specific manifest instead of publishing it", () => {
        const adapter = {
            platform: "mock",
            info: {
                platform: "mock",
                icon: "",
                capabilities: EMPTY_ADAPTER_CAPABILITIES,
                accounts: [{ uin: "malformed" }],
            },
            describeCapabilities: () => ({
                version: 1,
                actions: {},
                events: {},
                segments: {},
                transports: { webhook: { support: "native", mode: "http" } },
            }),
        } as unknown as Pick<Adapter, "describeCapabilities" | "info" | "platform">;

        expect(() => getAdapterInfo(adapter)).toThrow("mode 无效");
    });
});
