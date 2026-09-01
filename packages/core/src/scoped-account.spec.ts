import { describe, expect, it, vi } from "vitest";
import type { Account } from "./account.js";
import type { Adapter } from "./adapter.js";
import type { Protocol } from "./protocol.js";
import { ProtocolRegistry } from "./registry.js";
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

    it("拒绝账号工厂提前发布候选账号并恢复原账号集合", () => {
        const adapter = adapterFixture();
        const existing = accountFixture(adapter, { ...config, account_id: "existing" });
        const candidate = accountFixture(adapter, config);
        adapter.accounts.set("existing", existing);
        vi.mocked(adapter.createAccount).mockImplementation(() => {
            adapter.accounts.clear();
            adapter.accounts.set(config.account_id, candidate);
            return candidate;
        });
        const scope = scopeFixture();
        const router = {
            createRegistrationScope: vi.fn(() => scope),
        } as unknown as Router;

        expect(() => createAccountWithRouteScope({ router }, adapter, config)).toThrow(
            "账号 example/primary 工厂不得修改适配器账号集合；账号只能由宿主在验证后提交",
        );
        expect([...adapter.accounts]).toEqual([["existing", existing]]);
        expect(candidate.attachRouteScope).not.toHaveBeenCalled();
        expect(scope.close).toHaveBeenCalledOnce();
    });

    it("账号工厂修改集合后抛错时恢复集合并保留原始错误", () => {
        const adapter = adapterFixture();
        const existing = accountFixture(adapter, { ...config, account_id: "existing" });
        const factoryError = new Error("factory failed after mutation");
        adapter.accounts.set("existing", existing);
        vi.mocked(adapter.createAccount).mockImplementation(() => {
            adapter.accounts.delete("existing");
            throw factoryError;
        });

        let error: unknown;
        try {
            createAccountWithRouteScope({}, adapter, config);
        } catch (caught) {
            error = caught;
        }

        expect(error).toMatchObject({
            message: "账号 example/primary 工厂不得修改适配器账号集合；账号只能由宿主在验证后提交",
            cause: factoryError,
        });
        expect([...adapter.accounts]).toEqual([["existing", existing]]);
    });

    it("拒绝账号工厂替换账号集合引用并恢复宿主集合", () => {
        const adapter = adapterFixture();
        const originalAccounts = adapter.accounts;
        const candidate = accountFixture(adapter, config);
        vi.mocked(adapter.createAccount).mockImplementation(() => {
            Reflect.set(adapter, "accounts", new Map([["hidden", candidate]]));
            return candidate;
        });

        expect(() => createAccountWithRouteScope({}, adapter, config)).toThrow(
            "账号 example/primary 工厂不得修改适配器账号集合",
        );
        expect(adapter.accounts).toBe(originalAccounts);
        expect(adapter.accounts.size).toBe(0);
    });

    it("账号工厂安装异常访问器时无需读取它即可恢复宿主集合", () => {
        const adapter = adapterFixture();
        const originalAccounts = adapter.accounts;
        const candidate = accountFixture(adapter, config);
        vi.mocked(adapter.createAccount).mockImplementation(() => {
            Object.defineProperty(adapter, "accounts", {
                get: () => {
                    throw new Error("malicious getter");
                },
                configurable: true,
            });
            return candidate;
        });

        expect(() => createAccountWithRouteScope({}, adapter, config)).toThrow(
            "账号 example/primary 工厂不得修改适配器账号集合",
        );
        expect(adapter.accounts).toBe(originalAccounts);
    });

    it("账号集合引用被不可逆替换时同时保留越界与恢复错误", () => {
        const adapter = adapterFixture();
        const candidate = accountFixture(adapter, config);
        vi.mocked(adapter.createAccount).mockImplementation(() => {
            Object.defineProperty(adapter, "accounts", {
                value: new Map([["hidden", candidate]]),
                writable: false,
                configurable: false,
            });
            return candidate;
        });

        let error: unknown;
        try {
            createAccountWithRouteScope({}, adapter, config);
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).message).toBe(
            "账号 example/primary 工厂越过账号提交边界且账号集合无法恢复",
        );
        expect((error as AggregateError).errors).toEqual([
            expect.objectContaining({
                message:
                    "账号 example/primary 工厂不得修改适配器账号集合；账号只能由宿主在验证后提交",
            }),
            expect.objectContaining({ message: "无法恢复适配器账号集合引用" }),
        ]);
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

    it("拒绝账号注入未注册协议并撤销构造期路由", () => {
        const adapter = adapterFixture();
        const account = accountFixture(adapter, config);
        account.protocols.push(protocolFixture(adapter, account, "ghost", "v1"));
        vi.mocked(adapter.createAccount).mockReturnValue(account);
        const scope = scopeFixture();
        const router = {
            createRegistrationScope: vi.fn(() => scope),
        } as unknown as Router;

        expect(() => createAccountWithRouteScope({ router }, adapter, config)).toThrow(
            "账号 example/primary 工厂注入了未注册协议 ghost/v1",
        );
        expect(scope.close).toHaveBeenCalledOnce();
    });

    it("拒绝遗漏或重复账号配置中的已注册协议", () => {
        const name = "scoped-account-contract";
        ProtocolRegistry.register(name, "v1", vi.fn());
        const adapter = adapterFixture();
        const accountConfig = { ...config, [`${name}.v1`]: {} };
        try {
            const missing = accountFixture(adapter, accountConfig);
            vi.mocked(adapter.createAccount).mockReturnValueOnce(missing);
            expect(() => createAccountWithRouteScope({}, adapter, accountConfig)).toThrow(
                "账号 example/primary 工厂返回的协议集合与账号配置不一致",
            );

            const duplicate = accountFixture(adapter, accountConfig);
            duplicate.protocols.push(
                protocolFixture(adapter, duplicate, name, "v1"),
                protocolFixture(adapter, duplicate, name, "v1"),
            );
            vi.mocked(adapter.createAccount).mockReturnValueOnce(duplicate);
            expect(() => createAccountWithRouteScope({}, adapter, accountConfig)).toThrow(
                "账号 example/primary 工厂返回的协议集合与账号配置不一致",
            );
        } finally {
            ProtocolRegistry.unregister(name, "v1");
        }
    });

    it("接受与配置一一对应且归属当前账号的注册协议", () => {
        const name = "scoped-account-valid";
        ProtocolRegistry.register(name, "v1", vi.fn());
        const adapter = adapterFixture();
        const accountConfig = { ...config, [`${name}.v1`]: {} };
        const account = accountFixture(adapter, accountConfig);
        account.protocols.push(protocolFixture(adapter, account, name, "v1"));
        vi.mocked(adapter.createAccount).mockReturnValue(account);
        try {
            expect(createAccountWithRouteScope({}, adapter, accountConfig)).toBe(account);
        } finally {
            ProtocolRegistry.unregister(name, "v1");
        }
    });
});

function adapterFixture(): Adapter {
    return {
        createAccount: vi.fn(),
        accounts: new Map(),
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

function protocolFixture(
    adapter: Adapter,
    account: Account,
    name: string,
    version: string,
): Protocol {
    return {
        adapter,
        account,
        name,
        version,
        config: { protocol: name, version },
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        dispatch: vi.fn(async () => undefined),
        format: vi.fn(),
        apply: vi.fn(async () => undefined),
        on: vi.fn(),
        off: vi.fn(),
    } as unknown as Protocol;
}
