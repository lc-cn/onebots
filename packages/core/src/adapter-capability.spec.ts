import { describe, expect, it } from "vitest";
import {
    adapterActionMethodName,
    assertAdapterCapabilities,
    assertAdapterCapabilityContract,
    assertSupportedActionsImplemented,
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    restrictAdapterEventCapabilities,
    isCanonicalAdapterAction,
    listSupportedActions,
    normalizeAdapterCapabilities,
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

const introspectionManifest = defineAdapterCapabilities({
    actions: { get_supported_actions: { support: "native" } },
    events: {},
    segments: {},
    transports: {},
});

class IntrospectionAdapter extends Adapter {
    describeCapabilities() {
        return introspectionManifest;
    }

    createAccount(): never {
        throw new Error("测试不创建账号");
    }
}

class CapabilityBoundaryAdapter extends Adapter {
    constructor(manifest: Parameters<typeof normalizeAdapterCapabilities>[0]) {
        super({ db: { create: () => undefined } } as never, "mock", manifest);
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
    it("按账号可达事件生成受限清单并复用完整清单", () => {
        const manifest = defineAdapterCapabilities({
            actions: executableManifest.actions,
            events: { message: { support: "native" }, notice: { support: "native" } },
            segments: {},
            transports: {},
        });
        const all = new Set(Object.keys(manifest.events));
        expect(restrictAdapterEventCapabilities(manifest, all, "未订阅")).toBe(manifest);

        const restricted = restrictAdapterEventCapabilities(
            manifest,
            new Set(["message"]),
            event => `当前账号未订阅 ${event}`,
        );
        expect(restricted.events.message).toStrictEqual(manifest.events.message);
        expect(restricted.events.notice).toEqual({
            support: "unsupported",
            availability: "context",
            note: "当前账号未订阅 notice",
        });
        expect(restricted.actions).toEqual(manifest.actions);
    });

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

    it.each([
        {
            label: "未知顶层字段",
            manifest: {
                version: 1,
                actions: {},
                events: {},
                segments: {},
                transports: {},
                extra: true,
            },
            message: "能力清单包含未知字段 extra",
        },
        {
            label: "缺少分类",
            manifest: { version: 1, actions: {}, events: {}, segments: {} },
            message: "transports 必须是对象",
        },
        {
            label: "未知字段",
            manifest: {
                version: 1,
                actions: { send: { support: "native", typo: true } },
                events: {},
                segments: {},
                transports: {},
            },
            message: "包含未知字段 typo",
        },
        {
            label: "非法可用性",
            manifest: {
                version: 1,
                actions: { send: { support: "native", availability: "sometimes" } },
                events: {},
                segments: {},
                transports: {},
            },
            message: "availability 无效",
        },
        {
            label: "非法场景",
            manifest: {
                version: 1,
                actions: { send: { support: "native", scenes: ["thread"] } },
                events: {},
                segments: {},
                transports: {},
            },
            message: "scenes 必须为不重复的非空有效字符串",
        },
        {
            label: "非法权限类型",
            manifest: {
                version: 1,
                actions: { send: { support: "native", permissions: false } },
                events: {},
                segments: {},
                transports: {},
            },
            message: "permissions 必须为非空权限名",
        },
        {
            label: "缺少消息方向",
            manifest: {
                version: 1,
                actions: {},
                events: {},
                segments: { text: { support: "native" } },
                transports: {},
            },
            message: "direction 无效",
        },
        {
            label: "非法传输模式",
            manifest: {
                version: 1,
                actions: {},
                events: {},
                segments: {},
                transports: { gateway: { support: "native", mode: "tcp" } },
            },
            message: "mode 无效",
        },
    ])("运行时拒绝第三方插件的畸形能力清单: $label", ({ manifest, message }) => {
        expect(() => assertAdapterCapabilities(manifest)).toThrow(message);
    });

    it("规范化能力清单会创建不可变快照", () => {
        const source = {
            version: 1,
            actions: {
                send: {
                    support: "native",
                    permissions: ["message.send"],
                },
            },
            events: {},
            segments: {},
            transports: {},
        };
        const normalized = normalizeAdapterCapabilities(source as never);

        source.actions.send.support = "unsupported";
        source.actions.send.permissions.push("admin");

        expect(normalized.actions.send).toEqual({
            support: "native",
            permissions: ["message.send"],
        });
        expect(Object.isFrozen(normalized)).toBe(true);
        expect(Object.isFrozen(normalized.actions.send.permissions)).toBe(true);
    });

    it("Adapter 实例边界拒绝畸形清单并保存规范化快照", () => {
        expect(
            () =>
                new CapabilityBoundaryAdapter({
                    version: 1,
                    actions: {},
                    events: {},
                    segments: { text: { support: "native" } },
                    transports: {},
                } as never),
        ).toThrow("direction 无效");

        const source = {
            version: 1,
            actions: { ping: { support: "native" } },
            events: {},
            segments: {},
            transports: {},
        };
        const adapter = new CapabilityBoundaryAdapter(source as never);
        source.actions.ping.support = "unsupported";
        expect(adapter.describeCapabilities().actions.ping.support).toBe("native");
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
        expect(isCanonicalAdapterAction("send_message")).toBe(true);
        expect(isCanonicalAdapterAction("get_supported_actions")).toBe(true);
        expect(isCanonicalAdapterAction("get_account")).toBe(false);
    });

    it("通过显式 canonical 分支执行能力查询", async () => {
        const adapter = withoutConstructor(IntrospectionAdapter.prototype);
        await expect(adapter.callAction("bot", "get_supported_actions")).resolves.toEqual([
            "get_supported_actions",
        ]);
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
