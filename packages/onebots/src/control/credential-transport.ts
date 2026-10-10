import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";

function normalizedAddress(address: string): string {
    const version = isIP(address);
    if (!version) throw new Error("可信代理地址必须是明确的 IPv4 或 IPv6 地址");
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
    if (!address || !isIP(address)) return false;
    const normalized = normalizedAddress(address);
    if ([normalizedAddress("127.0.0.1"), normalizedAddress("::1")].includes(normalized))
        return true;
    // 代理须覆盖而非追加该头。多跳列表、重复头或任意客户端伪造的头都不可信。
    const forwarded = request.rawHeaders.filter(
        (header, index) => index % 2 === 0 && header.toLowerCase() === "x-forwarded-proto",
    );
    return (
        trustedProxies.includes(normalized) &&
        forwarded.length === 1 &&
        request.headers["x-forwarded-proto"] === "https"
    );
}
