import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";

const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet("127.0.0.0", 8, "ipv4");
loopbackAddresses.addAddress("::1", "ipv6");

function isLoopback(address: string): boolean {
    const version = isIP(address);
    return !!version && loopbackAddresses.check(address, version === 4 ? "ipv4" : "ipv6");
}

function hasLocalHost(request: IncomingMessage): boolean {
    if (!request.headers.host) return false;
    try {
        const host = new URL(`http://${request.headers.host}`);
        return (
            !host.username &&
            !host.password &&
            host.pathname === "/" &&
            !host.search &&
            !host.hash &&
            (host.hostname === "localhost" || isLoopback(host.hostname.replace(/^\[|\]$/g, "")))
        );
    } catch {
        // 格式无效的 Host 不能证明这是本机直连。
        return false;
    }
}

function normalizedAddress(address: string): string {
    const version = isIP(address);
    if (!version || address.includes("%"))
        throw new Error("可信代理地址必须是不含 scope ID 的明确 IPv4 或 IPv6 地址");
    // 同时匹配 IPv4 和双栈监听返回的 IPv4-mapped IPv6；统一 IPv6 的压缩写法。
    return new URL(`http://[${version === 4 ? `::ffff:${address}` : address}]`).hostname;
}

export function trustedControlProxyAddresses(
    configured?: readonly string[],
    environment = process.env.ONEBOTS_TRUSTED_PROXY_ADDRESSES,
): string[] {
    const addresses = configured ?? (environment?.trim() ? environment.split(",") : []);
    return addresses.map(address => normalizedAddress(address.trim()));
}

/** 仅授权秘密传输；不授予本机控制、引导认证或终端权限。 */
export function allowsControlCredentials(
    request: IncomingMessage,
    local: boolean,
    trustedProxies: readonly string[],
): boolean {
    if (local) return true;
    if ("encrypted" in request.socket && request.socket.encrypted === true) return true;
    const address = request.socket.remoteAddress;
    if (!address || !isIP(address) || address.includes("%")) return false;
    const normalized = normalizedAddress(address);
    const loopback = isLoopback(address);
    // 代理须覆盖而非追加该头。多跳列表、重复头或任意客户端伪造的头都不可信。
    const forwarded = request.rawHeaders.filter(
        (header, index) => index % 2 === 0 && header.toLowerCase() === "x-forwarded-proto",
    );
    // 回环地址只证明最后一跳在本机；代理的明文转发不能借此绕过传输门禁。
    if (loopback && forwarded.length === 0 && request.headers["x-forwarded-proto"] === undefined)
        return hasLocalHost(request);
    return (
        (loopback || trustedProxies.includes(normalized)) &&
        forwarded.length === 1 &&
        request.headers["x-forwarded-proto"] === "https"
    );
}

export const controlCredentialTransportHint =
    "仅接受本地控制连接或受保护的传输。请使用 HTTPS；代理需覆盖为唯一的 X-Forwarded-Proto: https，远程代理还需配置 ONEBOTS_TRUSTED_PROXY_ADDRESSES。";
