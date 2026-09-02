import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AccountConfigDriftError,
    AdapterRegistry,
    ProtocolRegistry,
    type Adapter,
    type Protocol,
    type Schema,
} from "@onebots/core";
import { App } from "./app.js";

const adapterSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号",
        ui: { section: "credentials" },
    },
    token: {
        type: "string",
        required: true,
        label: "Token",
        sensitive: true,
        ui: { section: "credentials" },
    },
};
const protocolSchema: Schema = {
    use_http: {
        type: "boolean",
        required: true,
        label: "HTTP",
        ui: { section: "transport" },
    },
};

beforeEach(() => {
    AdapterRegistry.clear();
    ProtocolRegistry.clear();
    AdapterRegistry.register("mock", (() => undefined) as unknown as Adapter.Factory);
    AdapterRegistry.registerSchema("mock", adapterSchema);
    ProtocolRegistry.register("test", "v1", (() => undefined) as unknown as Protocol.Factory);
    ProtocolRegistry.registerSchema("test.v1", protocolSchema);
});

afterEach(() => {
    AdapterRegistry.clear();
    ProtocolRegistry.clear();
});

describe("App account mutation validation", () => {
    it("磁盘配置不再是当前进程已应用版本时拒绝启动账号事务", () => {
        const method = Object.getOwnPropertyDescriptor(
            App.prototype,
            "assertAccountConfigSourceCurrent",
        )?.value as (configPath: string) => void;
        const app = {
            configPath: "/srv/onebots/config.yaml",
            runtimeConfigState: { status: "drifted" },
        };

        expect(() => Reflect.apply(method, app, ["/srv/onebots/config.yaml"])).toThrowError(
            AccountConfigDriftError,
        );
        expect(() => Reflect.apply(method, app, ["/tmp/other.yaml"])).not.toThrow();
    });

    it("通过主程序 Schema 钩子在创建适配器前拒绝无效候选账号", async () => {
        const findOrCreateAdapter = vi.fn();
        const app = Object.assign(Object.create(App.prototype) as App, {
            config: { general: { "test.v1": { use_http: true } } },
            isReloading: false,
            adapters: new Map(),
            findOrCreateAdapter,
        });

        await expect(
            app.addAccount({
                platform: "mock",
                account_id: "demo",
                "test.v1": {},
            }),
        ).rejects.toThrow(/mock\.demo\.token.*required/);

        expect(findOrCreateAdapter).not.toHaveBeenCalled();
        expect(app.config).toEqual({ general: { "test.v1": { use_http: true } } });
    });
});
