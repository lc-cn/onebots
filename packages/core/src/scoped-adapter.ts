import type { Adapter } from "./adapter.js";
import type { BaseApp } from "./base-app.js";
import type { RouterRegistrationScope } from "./router.js";

const routeScopes = new WeakMap<Adapter, RouterRegistrationScope>();

/** 在 Adapter 候选验收期间捕获路由，成功后把所有权延续到 Adapter 生命周期。 */
export function createAdapterWithRouteScope<T extends Adapter>(
    app: BaseApp,
    platform: string,
    operation: () => T,
): T {
    if (!app.router) return operation();
    const scope = app.router.createRegistrationScope({ platform });
    try {
        const adapter = scope.run(operation);
        routeScopes.set(adapter, scope);
        return adapter;
    } catch (error) {
        scope.close();
        throw error;
    }
}

/** 释放 Adapter 工厂拥有的全局 HTTP/WS 路由；重复调用安全。 */
export function closeAdapterRouteScope(adapter: Adapter): void {
    const scope = routeScopes.get(adapter);
    if (!scope) return;
    routeScopes.delete(adapter);
    scope.close();
}
