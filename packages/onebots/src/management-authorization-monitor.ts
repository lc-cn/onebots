import { validateManagementToken, type ManagementAuthHost } from "./management-auth.js";

export const MANAGEMENT_AUTHORIZATION_RECHECK_INTERVAL_MS = 30_000;

export interface ManagementAuthorizationMonitorOptions {
    onUnauthorized(): void;
    onAuthorized?(): void;
    intervalMs?: number;
}

/** 周期重验长连接的原始凭据，使会话自然过期后在有限时间内停止接收数据。 */
export function startManagementAuthorizationMonitor(
    host: ManagementAuthHost,
    token: string | undefined,
    options: ManagementAuthorizationMonitorOptions,
): () => void {
    let active = true;
    const stop = () => {
        if (!active) return;
        active = false;
        clearInterval(timer);
    };
    const timer = setInterval(() => {
        if (!validateManagementToken(host, token).valid) {
            stop();
            options.onUnauthorized();
            return;
        }
        options.onAuthorized?.();
    }, options.intervalMs ?? MANAGEMENT_AUTHORIZATION_RECHECK_INTERVAL_MS);
    timer.unref?.();
    return stop;
}
