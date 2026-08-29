import { WhatsAppApiError } from "./errors.js";
import type { WhatsAppClient } from "./client.js";
import type { WhatsAppCallOptions, WhatsAppSendMessageParams } from "./types.js";

export const WHATSAPP_PLATFORM_ACTIONS = new Set([
    "whatsapp_call",
    "send_native_message",
    "mark_message_read",
    "get_phone_number_info",
    "get_business_profile",
    "update_business_profile",
    "upload_media",
    "get_media",
    "download_media",
    "delete_media",
    "register_phone_number",
    "deregister_phone_number",
    "set_two_step_verification",
    "block_user",
    "unblock_user",
    "list_blocked_users",
    "list_message_templates",
    "create_message_template",
    "delete_message_template",
]);

/** 显式暴露常用 Cloud API，并以 whatsapp_call 覆盖新增 Graph API。 */
export async function executeWhatsAppPlatformAction(
    client: WhatsAppClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    switch (action) {
        case "whatsapp_call":
            return client.call(callOptions(params));
        case "send_native_message":
            return client.sendMessage(nativeMessage(params));
        case "mark_message_read":
            return client.markMessageRead(
                requireString(params, "message_id"),
                optionalBoolean(params, "typing_indicator") || false,
            );
        case "get_phone_number_info":
            return client.getPhoneNumberInfo();
        case "get_business_profile":
            return client.getBusinessProfile(optionalString(params, "fields"));
        case "update_business_profile":
            return client.updateBusinessProfile(requireRecord(params, "profile"));
        case "upload_media":
            return uploadMedia(client, params);
        case "get_media":
            return client.getMedia(requireString(params, "media_id"));
        case "download_media": {
            const mediaId = requireString(params, "media_id");
            const info = await client.getMedia(mediaId);
            const data = await client.downloadMediaFrom(info);
            return { ...info, data: data.toString("base64") };
        }
        case "delete_media":
            return client.deleteMedia(requireString(params, "media_id"));
        case "register_phone_number":
            return client.call({
                method: "POST",
                resource: `${client.config.phone_number_id}/register`,
                body: {
                    messaging_product: "whatsapp",
                    pin: requirePin(params),
                },
            });
        case "deregister_phone_number":
            return client.call({
                method: "POST",
                resource: `${client.config.phone_number_id}/deregister`,
                body: { messaging_product: "whatsapp" },
            });
        case "set_two_step_verification":
            return client.call({
                method: "POST",
                resource: `${client.config.phone_number_id}`,
                body: { pin: requirePin(params) },
            });
        case "block_user":
            return blockedUser(client, "POST", params);
        case "unblock_user":
            return blockedUser(client, "DELETE", params);
        case "list_blocked_users":
            return client.call({
                resource: `${client.config.phone_number_id}/block_users`,
                query: {
                    limit: optionalNumber(params, "limit"),
                    after: optionalString(params, "after"),
                },
            });
        case "list_message_templates":
            return client.call({
                resource: `${client.config.business_account_id}/message_templates`,
                query: {
                    fields: optionalString(params, "fields"),
                    limit: optionalNumber(params, "limit"),
                    after: optionalString(params, "after"),
                },
            });
        case "create_message_template":
            return client.call({
                method: "POST",
                resource: `${client.config.business_account_id}/message_templates`,
                body: requireRecord(params, "template"),
            });
        case "delete_message_template":
            return client.call({
                method: "DELETE",
                resource: `${client.config.business_account_id}/message_templates`,
                query: {
                    name: requireString(params, "name"),
                    hsm_id: optionalString(params, "template_id"),
                },
            });
        default:
            throw new WhatsAppApiError(`未知 WhatsApp 平台动作: ${action}`, {
                code: "WHATSAPP_UNKNOWN_ACTION",
            });
    }
}

function callOptions(params: Readonly<Record<string, unknown>>): WhatsAppCallOptions {
    const method = optionalString(params, "method")?.toUpperCase() || "GET";
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        invalidParameter("method 必须是 GET/POST/PUT/PATCH/DELETE");
    }
    return {
        method: method as WhatsAppCallOptions["method"],
        resource: requireString(params, "resource"),
        query: scalarRecord(params, "query"),
        body: params.body,
        headers: stringRecord(params, "headers"),
    };
}

function nativeMessage(params: Readonly<Record<string, unknown>>): WhatsAppSendMessageParams {
    const message = requireRecord(params, "message");
    const to = optionalString(message, "to") || requireString(params, "to");
    const type = optionalString(message, "type");
    if (!type) invalidParameter("message.type 不能为空");
    return { ...structuredClone(message), to, type };
}

async function uploadMedia(
    client: WhatsAppClient,
    params: Readonly<Record<string, unknown>>,
): Promise<{ id: string }> {
    const data = requireString(params, "data");
    if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(data)) {
        invalidParameter("data 必须是有效 Base64");
    }
    let bytes: Buffer;
    try {
        bytes = Buffer.from(data, "base64");
    } catch (error) {
        throw new WhatsAppApiError("data 必须是有效 Base64", {
            code: "WHATSAPP_INVALID_PARAMETER",
            cause: error,
        });
    }
    return client.uploadMedia(
        new Blob([Uint8Array.from(bytes)], { type: requireString(params, "mime_type") }),
        requireString(params, "mime_type"),
        optionalString(params, "filename") || "upload",
    );
}

function blockedUser(
    client: WhatsAppClient,
    method: "POST" | "DELETE",
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return client.call({
        method,
        resource: `${client.config.phone_number_id}/block_users`,
        body: {
            messaging_product: "whatsapp",
            block_users: [{ user: requireString(params, "user_id") }],
        },
    });
}

function requireString(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function optionalString(
    params: Readonly<Record<string, unknown>>,
    name: string,
): string | undefined {
    const value = params[name];
    return typeof value === "string" && value ? value : undefined;
}

function optionalBoolean(
    params: Readonly<Record<string, unknown>>,
    name: string,
): boolean | undefined {
    const value = params[name];
    return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(
    params: Readonly<Record<string, unknown>>,
    name: string,
): number | undefined {
    const value = params[name];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requireRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, unknown> {
    const value = optionalRecord(params, name);
    if (!value) invalidParameter(`${name} 必须是对象`);
    return value;
}

function optionalRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, unknown> | undefined {
    const value = params[name];
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function scalarRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, string | number | boolean | undefined> | undefined {
    const value = optionalRecord(params, name);
    if (!value) return undefined;
    const result: Record<string, string | number | boolean | undefined> = {};
    for (const [key, item] of Object.entries(value)) {
        if (
            item !== undefined &&
            typeof item !== "string" &&
            typeof item !== "number" &&
            typeof item !== "boolean"
        ) {
            invalidParameter(`${name}.${key} 必须是字符串、数字或布尔值`);
        }
        result[key] = item;
    }
    return result;
}

function stringRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, string> | undefined {
    const value = optionalRecord(params, name);
    if (!value) return undefined;
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item !== "string") invalidParameter(`${name}.${key} 必须是字符串`);
        result[key] = item;
    }
    return result;
}

function requirePin(params: Readonly<Record<string, unknown>>): string {
    const pin = requireString(params, "pin");
    if (!/^\d{6}$/u.test(pin)) invalidParameter("pin 必须是 6 位数字");
    return pin;
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
