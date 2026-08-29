import type { WeComClient } from "./client.js";
import { WeComApiError } from "./errors.js";
import type { WeComCallOptions } from "./types.js";

export const WECOM_PLATFORM_ACTIONS = new Set([
    "wecom_call",
    "send_native_message",
    "send_appchat_message",
    "recall_message",
    "update_template_card",
    "get_agent",
    "set_agent",
    "list_agents",
    "upload_temporary_media",
    "get_temporary_media",
    "create_appchat",
    "update_appchat",
    "get_appchat",
    "create_department",
    "update_department",
    "delete_department",
    "list_departments",
    "create_user",
    "update_user",
    "delete_user",
    "batch_delete_users",
    "list_department_users",
    "list_department_user_ids",
    "create_tag",
    "update_tag",
    "delete_tag",
    "get_tag",
    "list_tags",
    "add_tag_users",
    "delete_tag_users",
    "invite_users",
    "get_join_qrcode",
    "get_api_domain_ips",
    "get_callback_ips",
]);

/** 常用自建应用 API 的稳定动作入口；wecom_call 覆盖新增接口。 */
export function executeWeComPlatformAction(
    client: WeComClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    switch (action) {
        case "wecom_call":
            return client.call(callOptions(params));
        case "send_native_message":
            return client.sendApplicationMessage(requireRecord(params, "message"));
        case "send_appchat_message":
            return client.sendAppChatMessage(
                requireString(params, "chat_id"),
                requireRecord(params, "message"),
            );
        case "recall_message":
            return client.recallMessage(requireString(params, "message_id"));
        case "update_template_card":
            return post(
                client,
                "/cgi-bin/message/update_template_card",
                withAgent(client, requireRecord(params, "request")),
            );
        case "get_agent":
            return client.getAgent();
        case "set_agent":
            return post(
                client,
                "/cgi-bin/agent/set",
                withAgent(client, requireRecord(params, "agent")),
            );
        case "list_agents":
            return client.call({ path: "/cgi-bin/agent/list" });
        case "upload_temporary_media":
            return uploadMedia(client, params);
        case "get_temporary_media":
            return client.call({
                path: "/cgi-bin/media/get",
                query: { media_id: requireString(params, "media_id") },
                response_type: "buffer",
            });
        case "create_appchat":
            return post(client, "/cgi-bin/appchat/create", requireRecord(params, "chat"));
        case "update_appchat":
            return post(client, "/cgi-bin/appchat/update", requireRecord(params, "chat"));
        case "get_appchat":
            return client.getAppChat(requireString(params, "chat_id"));
        case "create_department":
            return post(client, "/cgi-bin/department/create", requireRecord(params, "department"));
        case "update_department":
            return post(client, "/cgi-bin/department/update", requireRecord(params, "department"));
        case "delete_department":
            return client.call({
                path: "/cgi-bin/department/delete",
                query: { id: requireNumber(params, "department_id") },
            });
        case "list_departments":
            return client.call({
                path: "/cgi-bin/department/list",
                query: { id: optionalNumber(params, "department_id") },
            });
        case "create_user":
            return post(client, "/cgi-bin/user/create", requireRecord(params, "user"));
        case "update_user":
            return post(client, "/cgi-bin/user/update", requireRecord(params, "user"));
        case "delete_user":
            return client.call({
                path: "/cgi-bin/user/delete",
                query: { userid: requireString(params, "user_id") },
            });
        case "batch_delete_users":
            return post(client, "/cgi-bin/user/batchdelete", {
                useridlist: requireStringArray(params, "user_ids"),
            });
        case "list_department_users":
            return client.listDepartmentUsers(
                requireNumber(params, "department_id"),
                optionalBoolean(params, "fetch_child") || false,
            );
        case "list_department_user_ids":
            return client.call({
                path: "/cgi-bin/user/simplelist",
                query: {
                    department_id: requireNumber(params, "department_id"),
                    fetch_child: optionalBoolean(params, "fetch_child") ? 1 : 0,
                },
            });
        case "create_tag":
            return post(client, "/cgi-bin/tag/create", requireRecord(params, "tag"));
        case "update_tag":
            return post(client, "/cgi-bin/tag/update", requireRecord(params, "tag"));
        case "delete_tag":
            return client.call({
                path: "/cgi-bin/tag/delete",
                query: { tagid: requireNumber(params, "tag_id") },
            });
        case "get_tag":
            return client.call({
                path: "/cgi-bin/tag/get",
                query: { tagid: requireNumber(params, "tag_id") },
            });
        case "list_tags":
            return client.call({ path: "/cgi-bin/tag/list" });
        case "add_tag_users":
            return tagUsers(client, "/cgi-bin/tag/addtagusers", params);
        case "delete_tag_users":
            return tagUsers(client, "/cgi-bin/tag/deltagusers", params);
        case "invite_users":
            return post(client, "/cgi-bin/batch/invite", requireRecord(params, "invitation"));
        case "get_join_qrcode":
            return client.call({
                path: "/cgi-bin/corp/get_join_qrcode",
                query: { size_type: optionalNumber(params, "size_type") },
            });
        case "get_api_domain_ips":
            return client.call({ path: "/cgi-bin/get_api_domain_ip" });
        case "get_callback_ips":
            return client.call({ path: "/cgi-bin/getcallbackip" });
        default:
            throw new WeComApiError(`未知企业微信平台动作: ${action}`, {
                code: "WECOM_UNKNOWN_ACTION",
            });
    }
}

function callOptions(params: Readonly<Record<string, unknown>>): WeComCallOptions {
    const method = optionalString(params, "method")?.toUpperCase();
    if (method && method !== "GET" && method !== "POST") invalid("method 必须是 GET 或 POST");
    const responseType = optionalString(params, "response_type");
    if (responseType && responseType !== "json" && responseType !== "buffer")
        invalid("response_type 必须是 json 或 buffer");
    return {
        method: method as WeComCallOptions["method"],
        path: requireString(params, "path"),
        query: scalarRecord(params, "query"),
        body: params.body,
        token: optionalBoolean(params, "token"),
        response_type: responseType as WeComCallOptions["response_type"],
    };
}

function post(client: WeComClient, path: string, body: unknown): Promise<unknown> {
    return client.call({ method: "POST", path, body });
}

function withAgent(client: WeComClient, value: Record<string, unknown>): Record<string, unknown> {
    return { ...value, agentid: Number(client.config.agent_id) };
}

function tagUsers(
    client: WeComClient,
    path: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return post(client, path, {
        tagid: requireNumber(params, "tag_id"),
        userlist: stringArray(params, "user_ids"),
        partylist: numberArray(params, "department_ids"),
    });
}

async function uploadMedia(
    client: WeComClient,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const type = requireString(params, "type");
    if (!["image", "voice", "video", "file"].includes(type))
        invalid("type 必须是 image/voice/video/file");
    const data = requireString(params, "data");
    if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(data))
        invalid("data 必须是有效 Base64");
    const bytes = Buffer.from(data, "base64");
    return client.uploadTemporaryMedia(
        type as "image" | "voice" | "video" | "file",
        new Blob([Uint8Array.from(bytes)], {
            type: optionalString(params, "mime_type") || "application/octet-stream",
        }),
        optionalString(params, "filename") || "upload",
    );
}

function requireString(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value) invalid(`${name} 必须是非空字符串`);
    return value;
}

function optionalString(
    params: Readonly<Record<string, unknown>>,
    name: string,
): string | undefined {
    const value = params[name];
    return typeof value === "string" && value ? value : undefined;
}

function requireNumber(params: Readonly<Record<string, unknown>>, name: string): number {
    const value = params[name];
    if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${name} 必须是数字`);
    return value;
}

function optionalNumber(
    params: Readonly<Record<string, unknown>>,
    name: string,
): number | undefined {
    const value = params[name];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(
    params: Readonly<Record<string, unknown>>,
    name: string,
): boolean | undefined {
    return typeof params[name] === "boolean" ? params[name] : undefined;
}

function requireRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, unknown> {
    const value = params[name];
    if (!isRecord(value)) invalid(`${name} 必须是对象`);
    return structuredClone(value);
}

function requireStringArray(params: Readonly<Record<string, unknown>>, name: string): string[] {
    const result = stringArray(params, name);
    if (!result.length) invalid(`${name} 必须是非空字符串数组`);
    return result;
}

function stringArray(params: Readonly<Record<string, unknown>>, name: string): string[] {
    const value = params[name];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item))
        invalid(`${name} 必须是字符串数组`);
    return [...value] as string[];
}

function numberArray(params: Readonly<Record<string, unknown>>, name: string): number[] {
    const value = params[name];
    if (value === undefined) return [];
    if (
        !Array.isArray(value) ||
        value.some(item => typeof item !== "number" || !Number.isFinite(item))
    )
        invalid(`${name} 必须是数字数组`);
    return [...value] as number[];
}

function scalarRecord(
    params: Readonly<Record<string, unknown>>,
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
        )
            invalid(`${name}.${key} 必须是标量`);
        result[key] = item as string | number | boolean | undefined;
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new WeComApiError(`企业微信 ${message}`, { code: "WECOM_INVALID_PARAMETER" });
}
