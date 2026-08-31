import { describe, expect, it } from "vitest";
import { getExtensionConfigurationAction } from "./extension-configuration.js";

describe("extension configuration action", () => {
    it("opens the account wizard with the adapter platform selected", () => {
        expect(
            getExtensionConfigurationAction({
                type: "adapter",
                configurationTarget: { kind: "account", platform: "telegram" },
            }),
        ).toEqual({
            label: "添加账号",
            to: { path: "/config", query: { add: "telegram" } },
        });
    });

    it("opens account outlets with the registered protocol schema key", () => {
        expect(
            getExtensionConfigurationAction({
                type: "protocol",
                configurationTarget: { kind: "protocol", protocolKey: "onebot.v11" },
            }),
        ).toEqual({
            label: "配置账号出口",
            to: { path: "/config", query: { protocol: "onebot.v11" } },
        });
    });

    it("falls back safely when the server returns a mismatched target", () => {
        expect(
            getExtensionConfigurationAction({
                type: "protocol",
                configurationTarget: { kind: "account", platform: "unexpected" },
            }),
        ).toEqual({
            label: "打开配置",
            to: { path: "/config", query: {} },
        });
    });
});
