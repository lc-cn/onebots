import { afterEach, describe, expect, it, vi } from "vitest";
import {
    AdapterRegistry,
    defineAdapterCapabilities,
    EMPTY_ADAPTER_CAPABILITIES,
    type Adapter,
} from "@onebots/core";
import { getAdapterInfo, getAdapterInfos } from "./adapter-info.js";

const factory = (() => undefined) as unknown as Adapter.Factory;

afterEach(() => AdapterRegistry.clear());

describe("adapter management info", () => {
    it("publishes a loaded adapter manifest before any account creates a runtime instance", () => {
        const capabilities = defineAdapterCapabilities({
            actions: { send_message: { support: "native" } },
            events: {},
            segments: {},
            transports: {},
        });
        AdapterRegistry.register("mock", factory, {
            displayName: "模拟平台",
            description: "用于首次配置",
            icon: "mock.svg",
            capabilities,
        });

        const infos = getAdapterInfos(
            [],
            [
                { type: "adapter", name: "mock", version: "1.2.3" },
                { type: "protocol", name: "test", version: "2.0.0" },
            ],
        );

        expect(infos).toEqual([
            expect.objectContaining({
                platform: "mock",
                displayName: "模拟平台",
                description: "用于首次配置",
                icon: "mock.svg",
                capabilities,
                capabilityDeclared: true,
                capabilitySource: "runtime",
                capabilityPackageVersion: "1.2.3",
                accountLifecycleControl: { online: false, offline: false },
                accounts: [],
            }),
        ]);
    });

    it("keeps a loaded third-party adapter with no manifest visible but explicitly unknown", () => {
        AdapterRegistry.register("third-party", factory, {
            displayName: "第三方平台",
        });

        const infos = getAdapterInfos(
            [],
            [{ type: "adapter", name: "third-party", version: null }],
        );

        expect(infos).toEqual([
            expect.objectContaining({
                platform: "third-party",
                capabilityDeclared: false,
                capabilitySource: "runtime",
                capabilityPackageVersion: null,
                capabilities: EMPTY_ADAPTER_CAPABILITIES,
                accounts: [],
            }),
        ]);
    });

    it("keeps an instantiated adapter authoritative without duplicating its loaded plugin", () => {
        AdapterRegistry.register("mock", factory);
        const adapter = {
            platform: "mock",
            info: {
                platform: "mock",
                icon: "",
                capabilities: EMPTY_ADAPTER_CAPABILITIES,
                accountLifecycleControl: { online: true, offline: false },
                accounts: [{ uin: "demo" }],
            },
            describeCapabilities: () => EMPTY_ADAPTER_CAPABILITIES,
        } as unknown as Adapter;

        const infos = getAdapterInfos(
            [adapter],
            [{ type: "adapter", name: "mock", version: "1.2.3" }],
        );

        expect(infos).toHaveLength(1);
        expect(infos[0]).toMatchObject({
            platform: "mock",
            capabilityPackageVersion: "1.2.3",
            accountLifecycleControl: { online: true, offline: false },
            accounts: [{ uin: "demo" }],
        });
    });

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
        } as unknown as Adapter;

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
        } as unknown as Adapter;

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
        } as unknown as Adapter;

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
        } as unknown as Adapter;

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
        } as unknown as Adapter;

        const published = getAdapterInfo(adapter).accountCapabilities.mutable;
        mutableCapabilities.actions.send_message.support = "unsupported";

        expect(published.actions.send_message.support).toBe("native");
        expect(Object.isFrozen(published)).toBe(true);
        expect(Object.isFrozen(published.actions.send_message)).toBe(true);
    });

    it("isolates a malformed account manifest while publishing other account overrides", () => {
        const logger = { error: vi.fn() };
        const limitedCapabilities = defineAdapterCapabilities({
            actions: { send_message: { support: "unsupported" } },
            events: {},
            segments: {},
            transports: {},
        });
        const adapter = {
            platform: "mock",
            logger,
            info: {
                platform: "mock",
                icon: "",
                capabilities: EMPTY_ADAPTER_CAPABILITIES,
                accounts: [{ uin: "malformed" }, { uin: "limited" }],
            },
            describeCapabilities: (accountId?: string) =>
                accountId === "limited"
                    ? limitedCapabilities
                    : ({
                          version: 1,
                          actions: {},
                          events: {},
                          segments: {},
                          transports: { webhook: { support: "native", mode: "http" } },
                      } as never),
        } as unknown as Adapter;

        const info = getAdapterInfo(adapter);

        expect(info.accountCapabilities).toEqual({ limited: limitedCapabilities });
        expect(info.accountCapabilityErrors).toEqual({
            malformed: {
                code: "capability_unavailable",
                message: expect.stringContaining("mode 无效"),
            },
        });
        expect(logger.error).toHaveBeenCalledWith(
            "账号 malformed 的能力清单不可用",
            expect.any(Error),
        );
    });
});
