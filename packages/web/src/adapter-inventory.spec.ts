import { describe, expect, it } from "vitest";
import { parseAdapterInventory } from "./adapter-inventory.js";

const defaultCapabilities = {
    version: 1 as const,
    actions: { send_message: { support: "native" as const } },
    events: {},
    segments: {},
    transports: {},
};
const limitedCapabilities = {
    version: 1 as const,
    actions: { send_message: { support: "unsupported" as const } },
    events: {},
    segments: {},
    transports: {},
};

function adapter(platform = "mock") {
    return {
        platform,
        displayName: "模拟平台",
        description: "测试适配器",
        icon: "",
        capabilities: defaultCapabilities,
        capabilityDeclared: true,
        capabilitySource: "runtime",
        capabilityPackageVersion: "1.2.3",
        capabilityStatus: "verified",
        accountLifecycleControl: { online: true, offline: false },
        accounts: [] as Array<Record<string, unknown>>,
        accountCapabilities: {} as Record<string, unknown>,
        accountCapabilityErrors: {} as Record<string, unknown>,
    };
}

function account(platform = "mock", uin = "bot") {
    return {
        uin,
        status: "online",
        avatar: "",
        platform,
        nickname: "测试机器人",
        dependency: "mock-sdk",
        startupTimeoutSeconds: 30,
        urls: ["/onebot/v11"],
        protocols: [
            {
                name: "onebot",
                version: "v11",
                path: "/onebot/v11",
                lifecycleStatus: "ready",
            },
        ],
    };
}

describe("adapter runtime inventory", () => {
    it("原子接受零账号、账号专属能力和隔离失败证据", () => {
        const empty = adapter();
        const configured = adapter("qq");
        configured.accounts = [account("qq", "limited"), account("qq", "broken")];
        configured.accountCapabilities = { limited: limitedCapabilities };
        configured.accountCapabilityErrors = {
            broken: { code: "capability_unavailable", message: "权限查询失败" },
        };
        const value = [empty, configured];

        expect(parseAdapterInventory(value)).toBe(value);
    });

    it("拒绝重复平台、重复账号和跨平台账号身份", () => {
        expect(() => parseAdapterInventory([adapter(), adapter()])).toThrow("重复平台");

        const duplicate = adapter();
        duplicate.accounts = [account(), account()];
        expect(() => parseAdapterInventory([duplicate])).toThrow("重复账号");

        const crossed = adapter();
        crossed.accounts = [account("other")];
        expect(() => parseAdapterInventory([crossed])).toThrow("平台身份不一致");
    });

    it("拒绝不闭合的默认能力与生命周期控制证据", () => {
        const missing = adapter();
        delete (missing as Partial<typeof missing>).accountCapabilities;
        expect(() => parseAdapterInventory([missing])).toThrow("缺少闭合的账号能力证据");

        const contradictory = adapter();
        contradictory.capabilityDeclared = false;
        contradictory.capabilityStatus = "unknown";
        expect(() => parseAdapterInventory([contradictory])).toThrow("结论与清单矛盾");

        const lifecycle = adapter();
        lifecycle.accountLifecycleControl = { online: true, offline: "yes" as never };
        expect(() => parseAdapterInventory([lifecycle])).toThrow("生命周期控制证据无效");
    });

    it("拒绝账号运行态、协议生命周期与 URL 列表矛盾", () => {
        const invalidStatus = adapter();
        invalidStatus.accounts = [{ ...account(), status: "unknown" }];
        expect(() => parseAdapterInventory([invalidStatus])).toThrow("运行态摘要无效");

        const invalidProtocol = adapter();
        invalidProtocol.accounts = [
            {
                ...account(),
                protocols: [{ ...account().protocols[0], lifecycleStatus: "unknown" }],
            },
        ];
        expect(() => parseAdapterInventory([invalidProtocol])).toThrow("协议生命周期条目无效");

        const driftedUrls = adapter();
        driftedUrls.accounts = [{ ...account(), urls: ["/stale"] }];
        expect(() => parseAdapterInventory([driftedUrls])).toThrow("URL 与生命周期列表矛盾");
    });

    it("拒绝未知账号、重复结论、等价覆写和超长诊断", () => {
        const unknown = adapter();
        unknown.accountCapabilities = { ghost: limitedCapabilities };
        expect(() => parseAdapterInventory([unknown])).toThrow("未知账号 ghost");

        const overlapping = adapter();
        overlapping.accounts = [account()];
        overlapping.accountCapabilities = { bot: limitedCapabilities };
        overlapping.accountCapabilityErrors = {
            bot: { code: "capability_unavailable", message: "读取失败" },
        };
        expect(() => parseAdapterInventory([overlapping])).toThrow("同时携带");

        const equivalent = adapter();
        equivalent.accounts = [account()];
        equivalent.accountCapabilities = { bot: structuredClone(defaultCapabilities) };
        expect(() => parseAdapterInventory([equivalent])).toThrow("与默认清单相同");

        const oversized = adapter();
        oversized.accounts = [account()];
        oversized.accountCapabilityErrors = {
            bot: { code: "capability_unavailable", message: "x".repeat(501) },
        };
        expect(() => parseAdapterInventory([oversized])).toThrow("失败诊断无效");
    });

    it("拒绝响应契约之外的适配器、账号和协议字段", () => {
        expect(() => parseAdapterInventory([{ ...adapter(), injected: true }])).toThrow(
            "未知字段 injected",
        );

        const accountInjection = adapter();
        accountInjection.accounts = [{ ...account(), token: "secret" }];
        expect(() => parseAdapterInventory([accountInjection])).toThrow("未知字段 token");

        const protocolInjection = adapter();
        protocolInjection.accounts = [
            {
                ...account(),
                protocols: [{ ...account().protocols[0], extra: true }],
            },
        ];
        expect(() => parseAdapterInventory([protocolInjection])).toThrow("未知字段 extra");
    });
});
