import { definePlatformActions, type PlatformActionHandler } from "onebots";
import { WhatsAppApiError } from "./errors.js";
import { WHATSAPP_GROUP_ACTIONS, type WhatsAppGroupAction } from "./groups.js";
import { WHATSAPP_CALLING_ACTION_HANDLERS } from "./calling.js";
import { WHATSAPP_HISTORY_ACTION_HANDLERS } from "./history.js";
import { WHATSAPP_SETTINGS_ACTION_HANDLERS } from "./settings.js";
import { WHATSAPP_ENCRYPTED_MESSAGE_ACTION_HANDLERS } from "./encrypted-messages.js";
import { WHATSAPP_PHONE_NUMBER_ACTION_HANDLERS } from "./phone-numbers.js";
import { WHATSAPP_BUSINESS_ENCRYPTION_ACTION_HANDLERS } from "./business-encryption.js";
import { WHATSAPP_BUSINESS_PROFILE_ACTION_HANDLERS } from "./business-profile.js";
import { WHATSAPP_BUSINESS_COMPLIANCE_ACTION_HANDLERS } from "./business-compliance.js";
import { WHATSAPP_SOLUTION_MIGRATION_ACTION_HANDLERS } from "./solution-migration.js";
import { WHATSAPP_COMMERCE_ACTION_HANDLERS } from "./commerce.js";
import { WHATSAPP_QR_CODE_ACTION_HANDLERS } from "./qr-codes.js";
import { WHATSAPP_MESSAGE_TEMPLATE_ACTION_HANDLERS } from "./message-templates.js";
import { WHATSAPP_FLOW_ACTION_HANDLERS } from "./flows.js";
import { WHATSAPP_BLOCKED_USER_ACTION_HANDLERS } from "./blocked-users.js";
import { WHATSAPP_MEDIA_ACTION_HANDLERS } from "./media.js";
import { WHATSAPP_CONVERSATIONAL_AUTOMATION_ACTION_HANDLERS } from "./conversational-automation.js";
import { WHATSAPP_WEBHOOK_SUBSCRIPTION_ACTION_HANDLERS } from "./webhook-subscriptions.js";
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
    ...WHATSAPP_ENCRYPTED_MESSAGE_ACTION_HANDLERS,
    ...WHATSAPP_PHONE_NUMBER_ACTION_HANDLERS,
    ...WHATSAPP_BUSINESS_ENCRYPTION_ACTION_HANDLERS,
    ...WHATSAPP_BUSINESS_PROFILE_ACTION_HANDLERS,
    ...WHATSAPP_BUSINESS_COMPLIANCE_ACTION_HANDLERS,
    ...WHATSAPP_SOLUTION_MIGRATION_ACTION_HANDLERS,
    ...WHATSAPP_COMMERCE_ACTION_HANDLERS,
    ...WHATSAPP_QR_CODE_ACTION_HANDLERS,
    ...WHATSAPP_MESSAGE_TEMPLATE_ACTION_HANDLERS,
    ...WHATSAPP_FLOW_ACTION_HANDLERS,
    ...WHATSAPP_BLOCKED_USER_ACTION_HANDLERS,
    ...WHATSAPP_MEDIA_ACTION_HANDLERS,
    ...WHATSAPP_CONVERSATIONAL_AUTOMATION_ACTION_HANDLERS,
    ...WHATSAPP_WEBHOOK_SUBSCRIPTION_ACTION_HANDLERS,
    whatsapp_call: (client, params) => client.call(callOptions(params)),
    send_native_message: (client, params) => client.sendMessage(nativeMessage(params)),
    mark_message_read: (client, params) =>
        client.markMessageRead(
            requireString(params, "message_id"),
            optionalBoolean(params, "typing_indicator") || false,
        ),
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

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
