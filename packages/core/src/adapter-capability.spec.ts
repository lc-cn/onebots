import { describe, expect, it } from "vitest";
import {
    assertAdapterCapabilities,
    assertAdapterCapabilityContract,
    defineAdapterCapabilities,
    listSupportedActions,
} from "./adapter-capability.js";
import { ValidationError } from "./errors.js";

describe("adapter capability manifest", () => {
    it("只将 native 与 emulated 动作暴露为支持", () => {
        const manifest = defineAdapterCapabilities({
            actions: {
                send_message: { support: "native" },
                get_group_list: { support: "emulated" },
                delete_message: { support: "unsupported" },
            },
            events: {},
            segments: {},
            transports: {},
        });

        expect(listSupportedActions(manifest)).toEqual(["get_group_list", "send_message"]);
        expect(Object.isFrozen(manifest)).toBe(true);
        expect(Object.isFrozen(manifest.actions.send_message)).toBe(true);
    });

    it("拒绝未声明权限名称的 permission 能力", () => {
        expect(() =>
            defineAdapterCapabilities({
                actions: {
                    get_user_info: { support: "native", availability: "permission" },
                },
                events: {},
                segments: {},
                transports: {},
            }),
        ).toThrow(ValidationError);
    });

    it("契约断言会发现查询结果与清单漂移", async () => {
        const manifest = defineAdapterCapabilities({
            actions: { send_message: { support: "native" } },
            events: {},
            segments: {},
            transports: {},
        });
        const adapter = {
            describeCapabilities: () => manifest,
            getSupportedActions: async () => ["delete_message"],
        };

        await expect(assertAdapterCapabilityContract(adapter)).rejects.toThrow(ValidationError);
        expect(() => assertAdapterCapabilities(manifest)).not.toThrow();
    });
});
