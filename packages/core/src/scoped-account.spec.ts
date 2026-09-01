import { describe, expect, it, vi } from "vitest";
import type { Account } from "./account.js";
import type { Adapter } from "./adapter.js";
import type { Router, RouterRegistrationScope } from "./router.js";
import { createAccountWithRouteScope } from "./scoped-account.js";

const config = { platform: "example", account_id: "primary" };

describe("scoped account factory contract", () => {
    it("接受身份与所有权一致的账号并绑定构造期路由作用域", () => {
        const adapter = adapterFixture();
        const account = accountFixture(adapter, config);
        vi.mocked(adapter.createAccount).mockReturnValue(account);
        const scope = scopeFixture();
        const router = {
            createRegistrationScope: vi.fn(() => scope),
        } as unknown as Router;

        expect(createAccountWithRouteScope({ router }, adapter, config)).toBe(account);
        expect(scope.run).toHaveBeenCalledOnce();
        expect(account.attachRouteScope).toHaveBeenCalledWith(scope);
        expect(scope.close).not.toHaveBeenCalled();
    });

    it("拒绝其他适配器拥有的账号并撤销构造期路由", () => {
        const adapter = adapterFixture();
        const foreignAdapter = adapterFixture();
        const account = accountFixture(foreignAdapter, config);
        vi.mocked(adapter.createAccount).mockReturnValue(account);
        const scope = scopeFixture();
        const router = {
            createRegistrationScope: vi.fn(() => scope),
        } as unknown as Router;

        expect(() => createAccountWithRouteScope({ router }, adapter, config)).toThrow(
            "账号 example/primary 工厂返回了不属于当前适配器的实例",
        );
        expect(account.attachRouteScope).not.toHaveBeenCalled();
        expect(scope.close).toHaveBeenCalledOnce();
    });

    it("拒绝被替换的账号实例或配置身份", () => {
        const adapter = adapterFixture();
        const wrongIdentity = accountFixture(adapter, {
            platform: "example",
            account_id: "secondary",
        });
        vi.mocked(adapter.createAccount).mockReturnValueOnce(wrongIdentity);

        expect(() => createAccountWithRouteScope({}, adapter, config)).toThrow(
            "账号 example/primary 工厂返回的账号身份不一致：实例为 example/secondary，配置为 example/secondary",
        );

        const wrongConfig = accountFixture(adapter, {
            platform: "example",
            account_id: "secondary",
        });
        Reflect.set(wrongConfig, "platform", config.platform);
        Reflect.set(wrongConfig, "account_id", config.account_id);
        vi.mocked(adapter.createAccount).mockReturnValueOnce(wrongConfig);
        expect(() => createAccountWithRouteScope({}, adapter, config)).toThrow(
            "账号 example/primary 工厂返回的账号身份不一致：实例为 example/primary，配置为 example/secondary",
        );
    });

    it("拒绝缺少核心运行接口的账号返回值", () => {
        const adapter = adapterFixture();
        const incomplete = accountFixture(adapter, config);
        Reflect.deleteProperty(incomplete, "stop");
        vi.mocked(adapter.createAccount).mockReturnValueOnce(incomplete);
        expect(() => createAccountWithRouteScope({}, adapter, config)).toThrow(
            "账号 example/primary 工厂返回值缺少必需方法：stop",
        );
    });
});

function adapterFixture(): Adapter {
    return {
        createAccount: vi.fn(),
    } as unknown as Adapter;
}

function accountFixture(adapter: Adapter, accountConfig: Account.Config): Account {
    return {
        adapter,
        config: accountConfig,
        platform: accountConfig.platform,
        account_id: accountConfig.account_id,
        protocols: [],
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        dispatch: vi.fn(),
        dispatchAwaited: vi.fn(async () => undefined),
        dispatchManyAwaited: vi.fn(async () => undefined),
        attachRouteScope: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        removeAllListeners: vi.fn(),
    } as unknown as Account;
}

function scopeFixture(): RouterRegistrationScope {
    return {
        run: vi.fn((operation: () => Account) => operation()),
        close: vi.fn(),
    } as unknown as RouterRegistrationScope;
}
