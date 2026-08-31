import { describe, expect, it } from "vitest";
import { getExtensionConfigurationAction } from "./extension-configuration.js";

describe("extension configuration action", () => {
    it("opens the account wizard with the adapter platform selected", () => {
        expect(
            getExtensionConfigurationAction({
                type: "adapter",
                configurationTarget: { kind: "account", platform: "telegram" },
                configurationError: null,
            }),
        ).toEqual({
            available: true,
            label: "添加账号",
            to: { path: "/config", query: { add: "telegram" } },
        });
    });

    it("opens account outlets with the registered protocol schema key", () => {
        expect(
            getExtensionConfigurationAction({
                type: "protocol",
                configurationTarget: { kind: "protocol", protocolKey: "onebot.v11" },
                configurationError: null,
            }),
        ).toEqual({
            available: true,
            label: "配置账号出口",
            to: { path: "/config", query: { protocol: "onebot.v11" } },
        });
    });

    it("falls back safely when the server returns a mismatched target", () => {
        expect(
            getExtensionConfigurationAction({
                type: "protocol",
                configurationTarget: { kind: "account", platform: "unexpected" },
                configurationError: null,
            }),
        ).toEqual({
            available: false,
            label: "打开配置",
            to: { path: "/config", query: {} },
        });
    });

    it("disables a configuration action rejected by the server contract", () => {
        expect(
            getExtensionConfigurationAction({
                type: "protocol",
                configurationTarget: { kind: "protocol", protocolKey: "wrong.v1" },
                configurationError: "协议 onebot-v11 的配置目标必须是 onebot.v11",
            }),
        ).toEqual({
            available: false,
            label: "配置入口不可用",
            to: { path: "/config", query: {} },
        });
    });
});
