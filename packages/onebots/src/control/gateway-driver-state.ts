import {
    GATEWAY_PROTOCOL_VERSION,
    type GatewayReadyMessage,
    type GatewayStartMessage,
} from "../gateway/contracts.js";

export function groupExists(pid: number | undefined): boolean {
    if (!pid || process.platform === "win32") return false;
    try {
        process.kill(-pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
}

/** 子进程仅继承运行所需环境，不继承管理服务的凭据。 */
export function gatewayEnvironment(): NodeJS.ProcessEnv {
    const result: NodeJS.ProcessEnv = {};
    for (const key of [
        "PATH",
        "SystemRoot",
        "WINDIR",
        "TMPDIR",
        "TMP",
        "TEMP",
        "LANG",
        "LC_ALL",
        "TZ",
    ]) {
        if (process.env[key] !== undefined) result[key] = process.env[key];
    }
    result.NODE_ENV = "production";
    return result;
}

export function isReady(value: unknown, start: GatewayStartMessage): value is GatewayReadyMessage {
    if (!value || typeof value !== "object") return false;
    const message = value as Partial<GatewayReadyMessage>;
    return (
        message.type === "gateway.ready" &&
        message.protocolVersion === GATEWAY_PROTOCOL_VERSION &&
        message.controlInstanceId === start.controlInstanceId &&
        message.gatewayInstanceId === start.gatewayInstanceId &&
        message.configVersion === start.configVersion &&
        message.dependencyVersion === start.dependencyVersion &&
        (message.capabilities === undefined ||
            (Array.isArray(message.capabilities) &&
                message.capabilities.length <= 6 &&
                new Set(message.capabilities).size === message.capabilities.length &&
                message.capabilities.every(value =>
                    [
                        "mcp",
                        "send",
                        "message-debug",
                        "verification",
                        "account-explore",
                        "configuration",
                    ].includes(value),
                ))) &&
        message.address?.host === "127.0.0.1" &&
        Number.isInteger(message.address.port) &&
        message.address.port > 0 &&
        message.address.port <= 65535
    );
}

export async function waitForClose(
    managed: { closed: Promise<void> },
    timeoutMs: number,
): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            managed.closed.then(() => true),
            new Promise<boolean>(resolve => {
                timer = setTimeout(() => resolve(false), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
