import type { Account } from "./account.js";
import type { Adapter } from "./adapter.js";
import type { Router } from "./router.js";
import { assertAccountFactoryContract } from "./extension-factory-contract.js";
import { ValidationError } from "./errors.js";
import { ProtocolRegistry } from "./registry.js";

interface ScopedAccountHost {
    /** 纯事务测试或嵌入式替身可以不提供 Router。 */
    router?: Router;
}

/** 在账号构造期捕获适配器路由，并把同一作用域延续到账号启动期。 */
export function createAccountWithRouteScope(
    host: ScopedAccountHost,
    adapter: Adapter,
    config: Account.Config,
): Account {
    if (!host.router) {
        const account = invokeAccountFactory(adapter, config, () => adapter.createAccount(config));
        assertAccountFactoryContract(account, adapter, config);
        ProtocolRegistry.assertAccountProtocols(account, adapter, config);
        return account;
    }
    const scope = host.router.createRegistrationScope({
        platform: String(config.platform),
        account_id: String(config.account_id),
    });
    try {
        const account = invokeAccountFactory(adapter, config, () =>
            scope.run(() => adapter.createAccount(config)),
        );
        assertAccountFactoryContract(account, adapter, config);
        ProtocolRegistry.assertAccountProtocols(account, adapter, config);
        account.attachRouteScope(scope);
        return account;
    } catch (error) {
        scope.close();
        throw error;
    }
}

interface AccountMapSnapshot {
    reference: Map<string, Account>;
    descriptor: PropertyDescriptor;
    entries: Array<readonly [string, Account]>;
}

/** 账号映射由宿主在候选实例验收后提交，第三方工厂不得提前发布或删除账号。 */
function invokeAccountFactory(
    adapter: Adapter,
    config: Account.Config,
    operation: () => Account,
): Account {
    const snapshot = captureAccountMap(adapter);
    let returned = false;
    let account: Account | undefined;
    let factoryError: unknown;
    try {
        account = operation();
        returned = true;
    } catch (error) {
        factoryError = error;
    }

    if (!accountMapMatches(adapter, snapshot)) {
        const label = `账号 ${config.platform}/${config.account_id}`;
        const violation = new ValidationError(
            `${label} 工厂不得修改适配器账号集合；账号只能由宿主在验证后提交`,
            {
                context: {
                    platform: config.platform,
                    account_id: config.account_id,
                },
                ...(factoryError instanceof Error ? { cause: factoryError } : {}),
            },
        );
        try {
            restoreAccountMap(adapter, snapshot);
        } catch (error) {
            throw new AggregateError(
                [violation, error],
                `${label} 工厂越过账号提交边界且账号集合无法恢复`,
            );
        }
        throw violation;
    }
    if (!returned) throw factoryError;
    return account!;
}

function captureAccountMap(adapter: Adapter): AccountMapSnapshot {
    const reference = adapter.accounts as Map<string, Account>;
    const descriptor = Object.getOwnPropertyDescriptor(adapter, "accounts");
    if (!descriptor) throw new Error("适配器账号集合必须是实例自有属性");
    return { reference, descriptor, entries: [...reference.entries()] };
}

function accountMapMatches(adapter: Adapter, snapshot: AccountMapSnapshot): boolean {
    const descriptor = Object.getOwnPropertyDescriptor(adapter, "accounts");
    if (!descriptorMatches(descriptor, snapshot.descriptor)) return false;
    if (snapshot.reference.size !== snapshot.entries.length) return false;
    let index = 0;
    for (const [accountId, account] of snapshot.reference) {
        const expected = snapshot.entries[index++];
        if (!expected || expected[0] !== accountId || expected[1] !== account) return false;
    }
    return true;
}

function descriptorMatches(
    actual: PropertyDescriptor | undefined,
    expected: PropertyDescriptor,
): boolean {
    if (!actual) return false;
    if (actual.configurable !== expected.configurable || actual.enumerable !== expected.enumerable)
        return false;
    if ("value" in expected) {
        return (
            "value" in actual &&
            actual.value === expected.value &&
            actual.writable === expected.writable
        );
    }
    return actual.get === expected.get && actual.set === expected.set;
}

function restoreAccountMap(adapter: Adapter, snapshot: AccountMapSnapshot): void {
    const descriptor = Object.getOwnPropertyDescriptor(adapter, "accounts");
    if (!descriptorMatches(descriptor, snapshot.descriptor)) {
        try {
            Object.defineProperty(adapter, "accounts", snapshot.descriptor);
        } catch (error) {
            throw new Error("无法恢复适配器账号集合引用", {
                ...(error instanceof Error ? { cause: error } : {}),
            });
        }
    }
    Map.prototype.clear.call(snapshot.reference);
    for (const [accountId, account] of snapshot.entries) {
        Map.prototype.set.call(snapshot.reference, accountId, account);
    }
}
