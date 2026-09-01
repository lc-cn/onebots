import { managementRequestInit } from "./management-request.js";

export const AUTHENTICATION_REQUEST_TIMEOUT_MS = 5_000;

/** 认证端点必须有独立时间边界，并与页面生命周期提供的取消信号共同生效。 */
export function authenticationRequestInit(
    init: RequestInit = {},
    timeoutMs = AUTHENTICATION_REQUEST_TIMEOUT_MS,
): RequestInit {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    return managementRequestInit({
        ...init,
        redirect: init.redirect ?? "error",
        signal,
    });
}

export function authenticationRequestErrorMessage(error: unknown): string {
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    if (name === "TimeoutError") return "认证请求超时，请检查网关或反向代理";
    if (name === "AbortError") return "认证请求已取消";
    return "无法连接 OneBots 管理端，请检查服务和网络";
}
