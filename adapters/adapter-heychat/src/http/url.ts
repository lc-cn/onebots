import { ErrorCategory } from "onebots";
import { HeychatApiError } from "../errors.js";

/** 配置 URL 只允许可信 HTTPS；本机 HTTP 仅用于开发与测试。 */
export function normalizeHeychatBaseUrl(value: string, name: string): string {
    if (!URL.canParse(value)) throw invalidUrl(name, value);
    const url = new URL(value);
    if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol === "http:" && !isLoopback(url.hostname))
    ) {
        throw invalidUrl(name, value);
    }
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}

function isLoopback(hostname: string): boolean {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function invalidUrl(name: string, value: string): HeychatApiError {
    return new HeychatApiError(
        `配置 ${name} 必须是无凭据、查询参数或片段的 HTTPS URL（本机测试可用 HTTP）`,
        {
            code: "HEYCHAT_INVALID_CONFIG_URL",
            category: ErrorCategory.CONFIG,
            details: value,
        },
    );
}
