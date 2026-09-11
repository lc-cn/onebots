import type { IncomingMessage } from "node:http";

/**
 * PTY 是本机管理能力。即使同机反向代理让 socket 看起来来自回环地址，浏览器
 * 的 Host/Origin 仍必须明确指向回环主机，不能把设备会话升级成远程 shell。
 */
export function isLocalTerminalRequest(request: IncomingMessage, localTransport = false): boolean {
    if (localTransport) return true;
    if (!loopbackAddress(request.socket.remoteAddress)) return false;
    const host = hostname(request.headers.host);
    if (!host || !loopbackHost(host)) return false;
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
        const parsed = new URL(origin);
        return loopbackHost(parsed.hostname) && parsed.host === request.headers.host;
    } catch {
        return false;
    }
}

function hostname(host: string | undefined): string | undefined {
    if (!host) return undefined;
    try {
        return new URL(`http://${host}`).hostname;
    } catch {
        return undefined;
    }
}

function loopbackHost(value: string): boolean {
    return value === "localhost" || value === "127.0.0.1" || value === "[::1]";
}

function loopbackAddress(value?: string): boolean {
    return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}
