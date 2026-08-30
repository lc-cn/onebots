import { describe, expect, it } from "vitest";
import {
    adapterActionMethodName,
    assertAdapterCapabilities,
    assertAdapterCapabilityContract,
    assertSupportedActionsImplemented,
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    listSupportedActions,
} from "./adapter-capability.js";
import { ValidationError } from "./errors.js";
import { Adapter } from "./adapter.js";

const executableManifest = defineAdapterCapabilities({
    actions: { send_message: { support: "native" } },
    events: {},
    segments: {},
    transports: {},
});

class ImplementedActionAdapter extends Adapter {
    describeCapabilities() {
        return executableManifest;
    }

    createAccount(): never {
        throw new Error("测试不创建账号");
    }

    async sendMessage(): Promise<Adapter.SendMessageResult> {
        return { message_id: { string: "sent", number: 1, source: "sent" } };
    }
}

class MissingActionAdapter extends Adapter {
    describeCapabilities() {
        return executableManifest;
    }

    createAccount(): never {
        throw new Error("测试不创建账号");
    }
}

function withoutConstructor<T extends Adapter>(prototype: T): T {
    const adapter = Object.create(prototype) as T;
    adapter.platform = "mock";
    return adapter;
}

describe("adapter capability manifest", () => {
    it("从平台动作集合派生不可变能力描述", () => {
        const actions = definePlatformActionCapabilities(new Set(["send_card", "list_roles"]), {
            support: "native",
            availability: "permission",
            permissions: ["room.manage"],
        });

        expect(actions).toEqual({
            send_card: {
                support: "native",
                availability: "permission",
                permissions: ["room.manage"],
            },
            list_roles: {
                support: "native",
                availability: "permission",
                permissions: ["room.manage"],
            },
        });
        expect(Object.isFrozen(actions)).toBe(true);
        expect(Object.isFrozen(actions.send_card)).toBe(true);
        expect(Object.isFrozen(actions.send_card.permissions)).toBe(true);
    });

    it("支持按动作解析能力并拒绝无效注册表", () => {
        expect(
            definePlatformActionCapabilities(["send", "admin"] as const, action => ({
                support: "native",
                availability: action === "admin" ? "permission" : "always",
            })),
        ).toEqual({
            send: { support: "native", availability: "always" },
            admin: { support: "native", availability: "permission" },
        });
        expect(() => definePlatformActionCapabilities(["send", "send"])).toThrowError(
            "平台动作能力重复: send",
        );
        expect(() => definePlatformActionCapabilities([" "])).toThrowError(
            "平台动作能力名称不能为空",
        );
    });

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

    it("允许动态判权，并拒绝无效的权限名提示", () => {
        expect(() =>
            defineAdapterCapabilities({
                actions: {
                    get_user_info: { support: "native", availability: "permission" },
                },
                events: {},
                segments: {},
                transports: {},
            }),
        ).not.toThrow();

        expect(() =>
            defineAdapterCapabilities({
                actions: {
                    get_user_info: {
                        support: "native",
                        availability: "permission",
                        permissions: [""],
                    },
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

    it("将 canonical 动作名映射到适配器方法", () => {
        expect(adapterActionMethodName("get_group_member_list")).toBe("getGroupMemberList");
        expect(adapterActionMethodName("get_csrf_token")).toBe("getCsrfToken");
    });

    it("拒绝声明支持但没有实际实现的动作", () => {
        const manifest = defineAdapterCapabilities({
            actions: {
                send_message: { support: "native" },
                delete_message: { support: "native" },
            },
            events: {},
            segments: {},
            transports: {},
        });
        const adapter = {
            describeCapabilities: () => manifest,
            getSupportedActions: async () => listSupportedActions(manifest),
            isActionImplemented: (action: string) => action === "delete_message",
        };

        expect(() => assertSupportedActionsImplemented(adapter)).toThrow(
            "适配器能力清单声明了未实现动作: send_message",
        );
    });

    it("动作接口抽离后仍能区分覆写实现与基类占位实现", async () => {
        const implemented = withoutConstructor(ImplementedActionAdapter.prototype);
        const missing = withoutConstructor(MissingActionAdapter.prototype);

        expect(implemented.isActionImplemented("send_message")).toBe(true);
        expect(missing.isActionImplemented("send_message")).toBe(false);
        await expect(implemented.callAction("bot", "send_message", {})).resolves.toEqual({
            message_id: { string: "sent", number: 1, source: "sent" },
        });
        await expect(missing.callAction("bot", "send_message", {})).rejects.toMatchObject({
            code: "ADAPTER_CAPABILITY_UNAVAILABLE",
            capability: "send_message",
        });
    });
});
