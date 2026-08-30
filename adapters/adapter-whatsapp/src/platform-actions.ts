import { definePlatformActions, type PlatformActionHandler } from "onebots";
import { WhatsAppApiError } from "./errors.js";
import { WHATSAPP_GROUP_ACTIONS, type WhatsAppGroupAction } from "./groups.js";
import { WHATSAPP_CALLING_ACTION_HANDLERS } from "./calling.js";
import { WHATSAPP_HISTORY_ACTION_HANDLERS } from "./history.js";
import { WHATSAPP_SETTINGS_ACTION_HANDLERS } from "./settings.js";
import type { WhatsAppClient } from "./client.js";
import type { WhatsAppCallOptions, WhatsAppSendMessageParams } from "./types.js";

const GROUP_ACTION_HANDLERS = Object.fromEntries(
    [...WHATSAPP_GROUP_ACTIONS].map(action => [
        action,
        (client: WhatsAppClient, params: Readonly<Record<string, unknown>>) =>
            client.groups.execute(action, params),
    ]),
) as Record<WhatsAppGroupAction, PlatformActionHandler<WhatsAppClient>>;

const ACTION_HANDLERS = {
    ...GROUP_ACTION_HANDLERS,
    ...WHATSAPP_CALLING_ACTION_HANDLERS,
    ...WHATSAPP_HISTORY_ACTION_HANDLERS,
    ...WHATSAPP_SETTINGS_ACTION_HANDLERS,
    whatsapp_call: (client, params) => client.call(callOptions(params)),
    send_native_message: (client, params) => client.sendMessage(nativeMessage(params)),
    mark_message_read: (client, params) =>
        client.markMessageRead(
            requireString(params, "message_id"),
            optionalBoolean(params, "typing_indicator") || false,
        ),
    get_phone_number_info: client => client.getPhoneNumberInfo(),
    get_business_profile: (client, params) =>
        client.getBusinessProfile(optionalString(params, "fields")),
    update_business_profile: (client, params) =>
        client.updateBusinessProfile(requireRecord(params, "profile")),
    get_commerce_settings: client =>
        client.call({ resource: `${client.config.phone_number_id}/whatsapp_commerce_settings` }),
    update_commerce_settings: (client, params) =>
        client.call({
            method: "POST",
            resource: `${client.config.phone_number_id}/whatsapp_commerce_settings`,
            query: commerceSettings(params),
        }),
    list_qr_codes: (client, params) =>
        client.call({
            method: "GET",
            resource: `${client.config.phone_number_id}/message_qrdls`,
            query: { fields: optionalString(params, "fields") },
        }),
    get_qr_code: (client, params) =>
        client.call({
            method: "GET",
            resource: `${client.config.phone_number_id}/message_qrdls/${requireResourceId(params, "code")}`,
            query: { fields: optionalString(params, "fields") },
        }),
    create_qr_code: (client, params) =>
        client.call({
            method: "POST",
            resource: `${client.config.phone_number_id}/message_qrdls`,
            body: { prefilled_message: requireString(params, "prefilled_message") },
        }),
    update_qr_code: (client, params) =>
        client.call({
            method: "POST",
            resource: `${client.config.phone_number_id}/message_qrdls`,
            body: {
                code: requireResourceId(params, "code"),
                prefilled_message: requireString(params, "prefilled_message"),
            },
        }),
    delete_qr_code: (client, params) =>
        client.call({
            method: "DELETE",
            resource: `${client.config.phone_number_id}/message_qrdls/${requireResourceId(params, "code")}`,
        }),
    upload_media: (client, params) => uploadMedia(client, params),
    get_media: (client, params) => client.getMedia(requireString(params, "media_id")),
    download_media: async (client, params) => {
        const info = await client.getMedia(requireString(params, "media_id"));
        const data = await client.downloadMediaFrom(info);
        return { ...info, data: data.toString("base64") };
    },
    delete_media: (client, params) => client.deleteMedia(requireString(params, "media_id")),
    register_phone_number: (client, params) =>
        client.call({
            method: "POST",
            resource: `${client.config.phone_number_id}/register`,
            body: { messaging_product: "whatsapp", pin: requirePin(params) },
        }),
    deregister_phone_number: client =>
        client.call({
            method: "POST",
            resource: `${client.config.phone_number_id}/deregister`,
            body: { messaging_product: "whatsapp" },
        }),
    set_two_step_verification: (client, params) =>
        client.call({
            method: "POST",
            resource: client.config.phone_number_id,
            body: { pin: requirePin(params) },
        }),
    block_user: (client, params) => blockedUser(client, "POST", params),
    unblock_user: (client, params) => blockedUser(client, "DELETE", params),
    list_blocked_users: (client, params) =>
        client.call({
            resource: `${client.config.phone_number_id}/block_users`,
            query: {
                limit: optionalNumber(params, "limit"),
                after: optionalString(params, "after"),
            },
        }),
    list_message_templates: (client, params) =>
        client.call({
            resource: `${client.config.business_account_id}/message_templates`,
            query: {
                fields: optionalString(params, "fields"),
                limit: optionalNumber(params, "limit"),
                after: optionalString(params, "after"),
            },
        }),
    create_message_template: (client, params) =>
        client.call({
            method: "POST",
            resource: `${client.config.business_account_id}/message_templates`,
            body: requireRecord(params, "template"),
        }),
    delete_message_template: (client, params) =>
        client.call({
            method: "DELETE",
            resource: `${client.config.business_account_id}/message_templates`,
            query: {
                name: requireString(params, "name"),
                hsm_id: optionalString(params, "template_id"),
            },
        }),
    list_flows: (client, params) =>
        client.call({
            method: "GET",
            resource: `${client.config.business_account_id}/flows`,
            query: {
                fields: optionalString(params, "fields"),
                limit: optionalNumber(params, "limit"),
                after: optionalString(params, "after"),
            },
        }),
    create_flow: (client, params) =>
        client.call({
            method: "POST",
            resource: `${client.config.business_account_id}/flows`,
            body: requireRecord(params, "flow"),
        }),
    get_flow: (client, params) =>
        client.call({
            method: "GET",
            resource: requireResourceId(params, "flow_id"),
            query: { fields: optionalString(params, "fields") },
        }),
    update_flow: (client, params) =>
        client.call({
            method: "POST",
            resource: requireResourceId(params, "flow_id"),
            body: requireRecord(params, "flow"),
        }),
    delete_flow: (client, params) =>
        client.call({ method: "DELETE", resource: requireResourceId(params, "flow_id") }),
    publish_flow: (client, params) =>
        client.call({
            method: "POST",
            resource: `${requireResourceId(params, "flow_id")}/publish`,
        }),
    deprecate_flow: (client, params) =>
        client.call({
            method: "POST",
            resource: `${requireResourceId(params, "flow_id")}/deprecate`,
        }),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

const PLATFORM_ACTIONS = definePlatformActions(
    ACTION_HANDLERS,
    action =>
        new WhatsAppApiError(`未知 WhatsApp 平台动作: ${action}`, {
            code: "WHATSAPP_UNKNOWN_ACTION",
        }),
);

export const WHATSAPP_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type WhatsAppPlatformAction =
    typeof WHATSAPP_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 显式暴露常用 Cloud API，并以 whatsapp_call 覆盖新增 Graph API。 */
export async function executeWhatsAppPlatformAction(
    client: WhatsAppClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(client, action, params);
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

function requireResourceId(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = requireString(params, name);
    if (!/^[A-Za-z\d._:-]+$/u.test(value)) {
        invalidParameter(`${name} 必须是单段 Graph 资源 ID`);
    }
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

function commerceSettings(
    params: Readonly<Record<string, unknown>>,
): Record<string, boolean | undefined> {
    const isCartEnabled = booleanParam(params, "is_cart_enabled");
    const isCatalogVisible = booleanParam(params, "is_catalog_visible");
    if (isCartEnabled === undefined && isCatalogVisible === undefined) {
        invalidParameter("Commerce 设置至少需要 is_cart_enabled 或 is_catalog_visible");
    }
    return {
        is_cart_enabled: isCartEnabled,
        is_catalog_visible: isCatalogVisible,
    };
}

function booleanParam(
    params: Readonly<Record<string, unknown>>,
    name: string,
): boolean | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") invalidParameter(`${name} 必须是布尔值`);
    return value;
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
