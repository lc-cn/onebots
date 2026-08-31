import { FeishuError } from "./errors.js";
import type { FeishuApiRequestOptions } from "./types.js";

/** 规范化飞书/Lark/私有化端点，禁止凭据被发送到明文或夹带 URL。 */
export function normalizeFeishuEndpoint(value: string): string {
    let endpoint: URL;
    try {
        endpoint = new URL(value);
    } catch (error) {
        throw invalidEndpoint(value, error);
    }
    if (
        endpoint.protocol !== "https:" ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
    ) {
        throw invalidEndpoint(value);
    }
    return `${endpoint.origin}${endpoint.pathname.replace(/\/+$/u, "")}`;
}

/** 只从已验证的开放平台端点、路径和标量查询参数构造请求 URL。 */
export function buildFeishuApiUrl(
    endpoint: string,
    path: string,
    params?: FeishuApiRequestOptions["params"],
): string {
    const url = new URL(`${endpoint}${path}`);
    if (!params) return url.toString();
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) searchParams.append(key, String(value));
    url.search = searchParams.toString();
    return url.toString();
}

function invalidEndpoint(value: string, cause?: unknown): FeishuError {
    return new FeishuError("飞书 API endpoint 必须是无凭据、无查询参数的 HTTPS URL", {
        code: "FEISHU_ENDPOINT_INVALID",
        details: value,
        cause,
    });
}

/** 保留调用方已经序列化的 JSON 字符串，并将序列化错误归入稳定参数错误。 */
export function serializeFeishuRequestBody(
    body: FeishuApiRequestOptions["body"],
    operation: string,
): string | undefined {
    try {
        return typeof body === "string" ? body : body ? JSON.stringify(body) : undefined;
    } catch (error) {
        throw new FeishuError(`飞书 API ${operation} 请求体无法序列化`, {
            code: "FEISHU_INVALID_PARAM",
            operation,
            details: body,
            cause: error,
        });
    }
}
