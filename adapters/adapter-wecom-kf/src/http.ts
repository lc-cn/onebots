import { WeComKfError } from "./errors.js";
import { isSafeAbsoluteApiPath } from "onebots";
import type { KfJsonResponse } from "./types.js";

/** 将受限绝对 API path 解析到已校验的微信客服 Base URL。 */
export function resolveKfApiUrl(
    base: string,
    path: string,
    query?: Readonly<Record<string, string | number | boolean | undefined>>,
): URL {
    if (!isSafeAbsoluteApiPath(path)) throw invalid("API path 必须是安全的绝对路径", path);
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(query || {}))
        if (value !== undefined) url.searchParams.set(key, String(value));
    return url;
}

/** 校验 API Base URL，禁止凭据、查询参数和片段进入后续动作。 */
export function requireKfHttpsBase(value: string): string {
    if (!URL.canParse(value)) throw invalid("api_base_url 必须是有效 HTTPS URL");
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
        throw invalid("api_base_url 必须是无凭据、查询参数或片段的 HTTPS URL");
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}

export async function parseKfJson(response: Response, path: string): Promise<unknown> {
    try {
        return await response.json();
    } catch (error) {
        throw new WeComKfError("微信客服 API 返回无效 JSON", {
            code: "WECOM_KF_INVALID_RESPONSE",
            status: response.status,
            path,
            cause: error,
        });
    }
}

export function kfApiErrorCode(payload: KfJsonResponse): number {
    return payload.errcode;
}

export function createKfApiError(
    response: Response,
    payload: KfJsonResponse,
    path: string,
): WeComKfError {
    const code = payload.errcode || response.status;
    const message = payload.errmsg || response.statusText;
    return new WeComKfError(message || `微信客服 API 调用失败: ${code}`, {
        code: `WECOM_KF_${code}`,
        status: response.status,
        path,
        details: payload,
    });
}

export function createKfHttpError(response: Response, path: string): WeComKfError {
    return new WeComKfError(`微信客服 API 返回 HTTP ${response.status}`, {
        code: "WECOM_KF_HTTP_ERROR",
        status: response.status,
        path,
    });
}

export function isKfJsonResponse(response: Response): boolean {
    return (response.headers.get("content-type") || "").includes("json");
}

function invalid(message: string, path?: string): WeComKfError {
    return new WeComKfError(`微信客服 ${message}`, {
        code: "WECOM_KF_INVALID_PARAMETER",
        path,
    });
}
