import type { LineHttpContext, LineHttpResponse } from "./types.js";

export const LINE_JSON_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
} as const;

/** 跨 realm 识别 Fetch/WinterCG Request，不依赖 instanceof。 */
export function isLineFetchRequest(value: unknown): value is Request {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { method?: unknown; headers?: unknown; arrayBuffer?: unknown };
    return (
        typeof candidate.method === "string" &&
        typeof candidate.arrayBuffer === "function" &&
        Boolean(candidate.headers) &&
        typeof (candidate.headers as { get?: unknown }).get === "function"
    );
}

export function toLineFetchResponse(response: LineHttpResponse): Response {
    return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: response.headers,
    });
}

export function applyLineHttpResponse(context: LineHttpContext, response: LineHttpResponse): void {
    context.status = response.status;
    for (const [name, value] of Object.entries(response.headers)) context.set(name, value);
    context.body = response.body;
}

export function lineMethodNotAllowed(): LineHttpResponse {
    return {
        status: 405,
        headers: { ...LINE_JSON_HEADERS, Allow: "POST" },
        body: { error: { code: "LINE_METHOD_NOT_ALLOWED", message: "Method Not Allowed" } },
    };
}
