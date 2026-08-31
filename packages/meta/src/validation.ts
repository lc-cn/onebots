import { MetaError } from "./errors.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw MetaError.invalid(`${field} 必须是对象`);
    return value;
}

export function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) throw MetaError.invalid(`${field} 必须是非空字符串`);
    return value;
}

export function parseMetaApiOrigin(value: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch (error) {
        throw MetaError.invalid("Meta API Origin 不是有效 URL", { cause: String(error) });
    }
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
        throw MetaError.invalid("Meta API Origin 必须使用 HTTPS（本机测试可使用 HTTP）");
    }
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        throw MetaError.invalid("Meta API Origin 只能包含 scheme 与 authority");
    }
    return url;
}

export function parseMetaApiVersion(value: string): string {
    if (!/^v\d+\.\d+$/u.test(value)) throw MetaError.invalid("Meta API version 必须形如 v25.0");
    return value;
}

export function assertSafeGraphPath(path: string): void {
    if (!path.startsWith("/") || path.startsWith("//") || /[\\?#\u0000-\u001f\u007f]/u.test(path)) {
        throw MetaError.invalid("Meta Graph path 必须是无 query/fragment 的安全绝对 pathname");
    }
    let segments: string[];
    try {
        segments = path.split("/").map(segment => decodeURIComponent(segment).toLowerCase());
    } catch {
        throw MetaError.invalid("Meta Graph path 包含非法 percent encoding");
    }
    if (segments.some(segment => [".", ".."].includes(segment))) {
        throw MetaError.invalid("Meta Graph path 不得包含路径穿越");
    }
}
