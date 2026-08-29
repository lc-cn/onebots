import { FeishuError } from "./errors.js";
import type { FeishuApiRequestOptions } from "./types.js";

/** 只从已验证的开放平台端点、路径和标量查询参数构造请求 URL。 */
export function buildFeishuApiUrl(
    endpoint: string,
    path: string,
    params?: FeishuApiRequestOptions["params"],
): string {
    if (!params) return `${endpoint}${path}`;
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) searchParams.append(key, String(value));
    return `${endpoint}${path}?${searchParams.toString()}`;
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
