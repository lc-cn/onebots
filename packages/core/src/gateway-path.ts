import { isSafeAbsoluteApiPath } from "./api-path.js";

/**
 * 将宿主 HTTP 路径统一为 Koa Router 与本机诊断共同使用的 prefix。
 * 空字符串和根路径都表示不添加前缀；WebSocket pathname 不继承此值。
 */
export function normalizeGatewayPathPrefix(value: unknown): string {
    if (typeof value !== "string") throw new TypeError("网关 path 必须是字符串");
    const configured = value.trim();
    if (!configured || configured === "/") return "";
    if (configured.startsWith("//")) {
        throw new TypeError("网关 path 不能以 // 开头");
    }

    const withoutLeadingSlash = configured.startsWith("/") ? configured.slice(1) : configured;
    const withoutTrailingSlash = withoutLeadingSlash.replace(/\/+$/u, "");
    const normalized = `/${withoutTrailingSlash}`;
    if (!isSafeAbsoluteApiPath(normalized)) {
        throw new TypeError("网关 path 必须是不含查询串、片段或路径穿越的绝对路径前缀");
    }
    return normalized;
}
