import { WeComApiError } from "./errors.js";
import type { WeComWebhookResponse } from "./types.js";

/** 解析并校验企业微信 HTTP 响应的共享边界。 */
export async function parseJson(response: Response, path: string): Promise<unknown> {
    try {
        return await response.json();
    } catch (error) {
        throw new WeComApiError("企业微信 API 返回无效 JSON", {
            code: "WECOM_INVALID_RESPONSE",
            status: response.status,
            path,
            cause: error,
        });
    }
}

export function apiErrorCode(payload: unknown): number {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
    const value = (payload as Record<string, unknown>).errcode;
    return typeof value === "number" ? value : 0;
}

export function apiError(response: Response, payload: unknown, path: string): WeComApiError {
    const record = payload as Record<string, unknown>;
    const code = typeof record.errcode === "number" ? record.errcode : response.status;
    const message = typeof record.errmsg === "string" ? record.errmsg : response.statusText;
    return new WeComApiError(message || `企业微信 API 调用失败: ${code}`, {
        code: `WECOM_${code}`,
        status: response.status,
        path,
        details: payload,
    });
}

export function isJson(response: Response): boolean {
    return (response.headers.get("content-type") || "").includes("json");
}

export function responseFromWebhook(response: WeComWebhookResponse): Response {
    if (typeof response.body === "string") {
        return new Response(response.body, {
            status: response.status,
            headers: { "Content-Type": response.contentType || "text/plain" },
        });
    }
    return Response.json(response.body, { status: response.status });
}
