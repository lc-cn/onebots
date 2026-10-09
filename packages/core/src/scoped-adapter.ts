import type { Adapter } from "./adapter.js";
import type { BaseApp } from "./base-app.js";
import type { RouterRegistrationScope } from "./router.js";

const routeScopes = new WeakMap<Adapter, RouterRegistrationScope>();

/** 延迟挂载的共享 Host 属于平台，不随首次挂载它的账号一起释放。 */
export function runWithAdapterRouteScope<T>(adapter: Adapter, operation: () => T): T {
    const scope = routeScopes.get(adapter);
    return scope ? scope.run(operation) : operation();
}

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
    // 保留关闭后的作用域墓碑：迟到的 Host 初始化仍必须被撤销，不能落入无作用域路由。
    scope.close();
}
