import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account } from "./account.js";
import type { Adapter } from "./adapter.js";
import type { BaseApp } from "./base-app.js";
import type { Protocol } from "./protocol.js";
import { AdapterRegistry, ProtocolRegistry } from "./registry.js";

const inertAdapterFactory = (() => undefined) as unknown as Adapter.Factory;
const inertProtocolFactory = (() => undefined) as unknown as Protocol.Factory;

describe("extension factory registry boundary", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        AdapterRegistry.clear();
        ProtocolRegistry.clear();
    });

    it("拒绝协议工厂注册其他扩展并恢复原注册表", () => {
        const adapter = {} as Adapter;
        const account = {} as Account;
        AdapterRegistry.register("stable", inertAdapterFactory);
        ProtocolRegistry.register("expected", "v1", (() => {
            AdapterRegistry.register("ghost", inertAdapterFactory);
            return fakeProtocol(adapter, account, "expected", "v1");
        }) as Protocol.Factory);

        expect(() => ProtocolRegistry.create("expected", "v1", adapter, account, {})).toThrow(
            "协议 expected/v1 工厂不得修改扩展注册表；实例工厂只能创建候选实例",
        );
        expect(AdapterRegistry.getAdapterNames()).toEqual(["stable"]);
        expect(ProtocolRegistry.has("expected", "v1")).toBe(true);
    });

    it("适配器工厂删除协议后抛错时恢复注册表并保留原始错误", () => {
        const app = {} as BaseApp;
        const factoryError = new Error("factory failed after unregister");
        ProtocolRegistry.register("stable", "v1", inertProtocolFactory);
        AdapterRegistry.register("expected", (() => {
            ProtocolRegistry.unregister("stable", "v1");
            throw factoryError;
        }) as Adapter.Factory);

        let error: unknown;
        try {
            AdapterRegistry.create("expected", app);
        } catch (caught) {
            error = caught;
        }

        expect(error).toMatchObject({
            message: "适配器 expected 工厂不得修改扩展注册表；实例工厂只能创建候选实例",
            cause: factoryError,
        });
        expect(ProtocolRegistry.has("stable", "v1")).toBe(true);
        expect(AdapterRegistry.has("expected")).toBe(true);
    });

    it("允许实例工厂执行没有改变状态的幂等注册", () => {
        const adapter = {} as Adapter;
        const account = {} as Account;
        const factory = (() => {
            ProtocolRegistry.register("expected", "v1", factory);
            return fakeProtocol(adapter, account, "expected", "v1");
        }) as Protocol.Factory;
        ProtocolRegistry.register("expected", "v1", factory);

        expect(ProtocolRegistry.create("expected", "v1", adapter, account, {})).toMatchObject({
            name: "expected",
            version: "v1",
        });
    });

    it("注册表恢复失败时同时保留边界错误和恢复错误", () => {
        const adapter = {} as Adapter;
        const account = {} as Account;
        ProtocolRegistry.register("expected", "v1", (() => {
            AdapterRegistry.register("ghost", inertAdapterFactory);
            return fakeProtocol(adapter, account, "expected", "v1");
        }) as Protocol.Factory);
        vi.spyOn(AdapterRegistry, "restoreState").mockImplementationOnce(() => {
            throw new Error("restore unavailable");
        });

        let error: unknown;
        try {
            ProtocolRegistry.create("expected", "v1", adapter, account, {});
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).message).toBe(
            "协议 expected/v1 工厂越过注册表边界且扩展注册表无法恢复",
        );
        expect((error as AggregateError).errors).toEqual([
            expect.objectContaining({
                message: "协议 expected/v1 工厂不得修改扩展注册表；实例工厂只能创建候选实例",
            }),
            expect.objectContaining({ message: "restore unavailable" }),
        ]);
    });
});

function fakeProtocol(adapter: Adapter, account: Account, name: string, version: string): Protocol {
    return {
        name,
        version,
        adapter,
        account,
        config: { protocol: name, version },
        start: async () => undefined,
        stop: async () => undefined,
        dispatch: async () => undefined,
        format: () => ({}),
        apply: async () => undefined,
        on: () => undefined,
        off: () => undefined,
    } as unknown as Protocol;
}
