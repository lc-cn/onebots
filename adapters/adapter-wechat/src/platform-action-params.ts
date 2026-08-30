import type { WechatClient } from "./client.js";
import { WechatApiError } from "./errors.js";
import type {
    WechatApiCallOptions,
    WechatOutboundMessage,
    WechatTemplateMessage,
} from "./types.js";
import type { WechatActionHandler, WechatActionParams } from "./platform-action-context.js";

export function callOptions(params: WechatActionParams): WechatApiCallOptions {
    const method = optionalString(params, "method")?.toUpperCase() || undefined;
    if (method && method !== "GET" && method !== "POST") invalid("method 必须是 GET 或 POST");
    const responseType = optionalString(params, "response_type");
    if (responseType && responseType !== "json" && responseType !== "buffer") {
        invalid("response_type 必须是 json 或 buffer");
    }
    return {
        method: method as WechatApiCallOptions["method"],
        path: requireString(params, "path"),
        query: scalarRecord(params, "query"),
        body: params.body,
        token: optionalBoolean(params, "token"),
        responseType: responseType as WechatApiCallOptions["responseType"],
    };
}

export function post(client: WechatClient, path: string, body: unknown): Promise<unknown> {
    return client.call({ method: "POST", path, body });
}

export function postRecordAction(path: string, parameter: string): WechatActionHandler {
    return async (client, params) => post(client, path, requireRecord(params, parameter));
}

export function staticCall(path: string): WechatActionHandler {
    return async client => client.call({ path });
}

export function mediaIdAction(path: string): WechatActionHandler {
    return async (client, params) =>
        post(client, path, { media_id: requireString(params, "media_id") });
}

export function tagUsers(
    client: WechatClient,
    path: string,
    params: WechatActionParams,
): Promise<unknown> {
    return post(client, path, {
        openid_list: requireStringArray(params, "openids"),
        tagid: requireInteger(params, "tag_id"),
    });
}

export function openidList(
    client: WechatClient,
    path: string,
    params: WechatActionParams,
): Promise<unknown> {
    return post(client, path, { openid_list: requireStringArray(params, "openids") });
}

export async function uploadMedia(
    client: WechatClient,
    params: WechatActionParams,
    path = "/cgi-bin/media/upload",
    includeType = true,
): Promise<unknown> {
    const data = requireString(params, "data");
    if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(data)) {
        invalid("data 必须是有效 Base64");
    }
    const type = includeType ? requireString(params, "type") : "image";
    if (!["image", "voice", "video", "thumb"].includes(type)) {
        invalid("type 必须是 image/voice/video/thumb");
    }
    const bytes = Buffer.from(data, "base64");
    const form = new FormData();
    form.set(
        "media",
        new Blob([Uint8Array.from(bytes)], {
            type: optionalString(params, "mime_type") || "application/octet-stream",
        }),
        optionalString(params, "filename") || "upload",
    );
    const description = params.description;
    if (typeof description === "string") form.set("description", description);
    else if (isRecord(description)) form.set("description", JSON.stringify(description));
    return client.call({
        method: "POST",
        path,
        query: includeType ? { type } : undefined,
        body: form,
    });
}

export function requireMessage(params: WechatActionParams, name: string): WechatOutboundMessage {
    const value = requireRecord(params, name);
    if (typeof value.msgtype !== "string" || !value.msgtype) invalid(`${name}.msgtype 不能为空`);
    return structuredClone(value) as WechatOutboundMessage;
}

export function requireTemplate(params: WechatActionParams, name: string): WechatTemplateMessage {
    const value = requireRecord(params, name);
    if (
        typeof value.touser !== "string" ||
        typeof value.template_id !== "string" ||
        !isRecord(value.data)
    ) {
        invalid(`${name} 必须包含 touser、template_id 和 data`);
    }
    return structuredClone(value) as WechatTemplateMessage;
}

export function requireString(
    params: WechatActionParams,
    name: string,
    allowEmpty = false,
): string {
    const value = params[name];
    if (typeof value !== "string" || (!allowEmpty && !value)) {
        invalid(`${name} 必须是${allowEmpty ? "" : "非空"}字符串`);
    }
    return value;
}

export function optionalString(params: WechatActionParams, name: string): string | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value) invalid(`${name} 必须是非空字符串`);
    return value;
}

export function requireNumber(params: WechatActionParams, name: string): number {
    const value = params[name];
    if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${name} 必须是数字`);
    return value;
}

export function requireInteger(
    params: WechatActionParams,
    name: string,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
): number {
    const value = requireNumber(params, name);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        invalid(`${name} 必须是 ${min} 到 ${max} 的安全整数`);
    }
    return value;
}

export function optionalBoolean(params: WechatActionParams, name: string): boolean | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") invalid(`${name} 必须是布尔值`);
    return value;
}

export function optionalNumber(params: WechatActionParams, name: string): number | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${name} 必须是数字`);
    return value;
}

export function optionalInteger(
    params: WechatActionParams,
    name: string,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
): number | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
        invalid(`${name} 必须是 ${min} 到 ${max} 的安全整数`);
    }
    return value;
}

export function requireStringArray(params: WechatActionParams, name: string): string[] {
    const value = params[name];
    if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.some(item => typeof item !== "string" || !item)
    ) {
        invalid(`${name} 必须是非空字符串数组`);
    }
    return [...value] as string[];
}

export function requireRecord(params: WechatActionParams, name: string): Record<string, unknown> {
    const value = params[name];
    if (!isRecord(value)) invalid(`${name} 必须是对象`);
    return structuredClone(value);
}

function scalarRecord(
    params: WechatActionParams,
    name: string,
): Record<string, string | number | boolean | undefined> | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (!isRecord(value)) invalid(`${name} 必须是对象`);
    const result: Record<string, string | number | boolean | undefined> = {};
    for (const [key, item] of Object.entries(value)) {
        if (
            item !== undefined &&
            typeof item !== "string" &&
            typeof item !== "number" &&
            typeof item !== "boolean"
        ) {
            invalid(`${name}.${key} 必须是标量`);
        }
        result[key] = item as string | number | boolean | undefined;
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function invalid(message: string): never {
    throw new WechatApiError(`微信公众号 ${message}`, { code: "WECHAT_INVALID_PARAMETER" });
}
