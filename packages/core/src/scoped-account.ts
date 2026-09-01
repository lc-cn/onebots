import type { Account } from "./account.js";
import type { Adapter } from "./adapter.js";
import type { Router } from "./router.js";
import { assertAccountFactoryContract } from "./extension-factory-contract.js";

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
        const account = adapter.createAccount(config);
        assertAccountFactoryContract(account, adapter, config);
        return account;
    }
    const scope = host.router.createRegistrationScope({
        platform: String(config.platform),
        account_id: String(config.account_id),
    });
    try {
        const account = scope.run(() => adapter.createAccount(config));
        assertAccountFactoryContract(account, adapter, config);
        account.attachRouteScope(scope);
        return account;
    } catch (error) {
        scope.close();
        throw error;
    }
}
