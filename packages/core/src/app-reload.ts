import type { BaseApp } from "./base-app.js";
import { ConfigError } from "./errors.js";

const HOST_CONFIG_KEYS = [
    "port",
    "path",
    "database",
    "public_static_dir",
    "env",
    "keys",
    "proxy",
    "subdomainOffset",
    "proxyIpHeader",
    "maxIpsCount",
] as const satisfies readonly (keyof BaseApp.Config)[];

export type HostConfigKey = (typeof HOST_CONFIG_KEYS)[number];

/** 表示配置已验证且可保存，但必须重启进程才能完整应用。 */
export class HostConfigRestartRequiredError extends ConfigError {
    constructor(public readonly changed: readonly HostConfigKey[]) {
        super(`以下宿主配置需要重启进程后生效: ${changed.join(", ")}`, {
            context: { changed },
        });
        this.name = "HostConfigRestartRequiredError";
    }
}

/**
 * 热重载只替换账号、协议与运行时凭据；宿主网络、数据库及中间件配置必须重启。
 * 显式拒绝无法完整生效的配置，避免 Web 显示已应用而进程仍运行旧状态。
 */
export function assertHostConfigReloadable(
    current: Required<BaseApp.Config>,
    next: Required<BaseApp.Config>,
): void {
    const changed = HOST_CONFIG_KEYS.filter(
        key => JSON.stringify(current[key]) !== JSON.stringify(next[key]),
    );
    if (changed.length > 0) {
        throw new HostConfigRestartRequiredError(changed);
    }
}

/** 将环境变量端口显式解析为 TCP 端口，避免 Node 将数字字符串当作管道路径。 */
export function resolveListenPort(configured: number, environment?: string): number {
    if (environment === undefined || environment.trim() === "") return configured;
    const port = Number(environment);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new ConfigError(`PORT 必须是 0 到 65535 之间的整数，收到: ${environment}`);
    }
    return port;
}
