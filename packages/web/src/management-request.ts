/** 为管理 API 请求设置默认的强制刷新策略，同时保留调用方的显式选择。 */
export function managementRequestInit(init: RequestInit = {}): RequestInit {
    return {
        ...init,
        cache: init.cache ?? "no-store",
    };
}
