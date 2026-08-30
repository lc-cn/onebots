import type { DingTalkHttpContext, DingTalkHttpResponse } from "./types.js";

export const DINGTALK_JSON_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
} as const;

/** 跨 realm 识别 Fetch/WinterCG Request，不依赖 instanceof。 */
export function isDingTalkFetchRequest(value: unknown): value is Request {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { method?: unknown; headers?: unknown; json?: unknown };
    return (
        typeof candidate.method === "string" &&
        typeof candidate.json === "function" &&
        Boolean(candidate.headers) &&
        typeof (candidate.headers as { get?: unknown }).get === "function"
    );
}

export function toDingTalkFetchResponse(response: DingTalkHttpResponse): Response {
    return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: response.headers,
    });
}

export function applyDingTalkHttpResponse(
    context: DingTalkHttpContext,
    response: DingTalkHttpResponse,
): void {
    context.status = response.status;
    for (const [name, value] of Object.entries(response.headers)) context.set(name, value);
    context.body = response.body;
}

export function dingTalkMethodNotAllowed(): DingTalkHttpResponse {
    return {
        status: 405,
        headers: { ...DINGTALK_JSON_HEADERS, Allow: "POST" },
        body: { error: "Method Not Allowed", code: "DINGTALK_METHOD_NOT_ALLOWED" },
    };
}
