import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";

export interface WhatsAppCommerceSettingsEntry {
    id?: string;
    is_cart_enabled?: boolean;
    is_catalog_visible?: boolean;
}

export interface WhatsAppCommerceSettingsResponse {
    data: WhatsAppCommerceSettingsEntry[];
}

export interface WhatsAppCommerceSettingsUpdate {
    is_cart_enabled?: boolean;
    is_catalog_visible?: boolean;
}

export interface WhatsAppCommerceSettingsUpdateResponse {
    success: true;
}

/** Phone Number 级 Commerce 显示与购物车设置。 */
export class WhatsAppCommerce {
    constructor(private readonly client: WhatsAppClient) {}

    async get(): Promise<WhatsAppCommerceSettingsResponse> {
        return settingsResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.phone_number_id}/whatsapp_commerce_settings`,
            }),
        );
    }

    async update(
        settings: WhatsAppCommerceSettingsUpdate,
    ): Promise<WhatsAppCommerceSettingsUpdateResponse> {
        const response = await this.client.call<unknown>({
            method: "POST",
            resource: `${this.client.config.phone_number_id}/whatsapp_commerce_settings`,
            query: settingsUpdate(settings),
        });
        if (!isRecord(response) || response.success !== true) invalidResponse(response);
        return { success: true };
    }
}

type CommerceActionParams = Readonly<Record<string, unknown>>;

const COMMERCE_ACTION_HANDLERS = {
    get_commerce_settings: (client: WhatsAppClient) => client.commerce.get(),
    update_commerce_settings: (client: WhatsAppClient, params: CommerceActionParams) =>
        client.commerce.update(actionUpdate(params)),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Commerce 动作的执行与参数契约单一来源。 */
export const WHATSAPP_COMMERCE_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    COMMERCE_ACTION_HANDLERS,
    {
        get_commerce_settings: [],
        update_commerce_settings: ["is_cart_enabled", "is_catalog_visible"],
    },
);

export type WhatsAppCommerceAction = keyof typeof WHATSAPP_COMMERCE_ACTION_HANDLERS;

export function isWhatsAppCommerceAction(action: string): action is WhatsAppCommerceAction {
    return Object.hasOwn(WHATSAPP_COMMERCE_ACTION_HANDLERS, action);
}

function settingsResponse(value: unknown): WhatsAppCommerceSettingsResponse {
    if (!isRecord(value) || !Array.isArray(value.data)) invalidResponse(value);
    return { data: value.data.map(settingsEntry) };
}

function settingsEntry(value: unknown): WhatsAppCommerceSettingsEntry {
    if (!isRecord(value)) invalidResponse(value);
    return {
        ...optionalResponseString(value, "id"),
        ...optionalResponseBoolean(value, "is_cart_enabled"),
        ...optionalResponseBoolean(value, "is_catalog_visible"),
    };
}

function actionUpdate(params: Readonly<Record<string, unknown>>): WhatsAppCommerceSettingsUpdate {
    const query = settingsUpdate(params);
    return {
        ...(query.is_cart_enabled === undefined ? {} : { is_cart_enabled: query.is_cart_enabled }),
        ...(query.is_catalog_visible === undefined
            ? {}
            : { is_catalog_visible: query.is_catalog_visible }),
    };
}

function settingsUpdate(value: unknown): Record<string, boolean> {
    if (!isRecord(value)) invalidParameter("Commerce 设置必须是对象");
    const unknown = Object.keys(value).find(
        name => name !== "is_cart_enabled" && name !== "is_catalog_visible",
    );
    if (unknown) invalidParameter(`Commerce 设置包含未知字段: ${unknown}`);
    const isCartEnabled = optionalBoolean(value, "is_cart_enabled");
    const isCatalogVisible = optionalBoolean(value, "is_catalog_visible");
    if (isCartEnabled === undefined && isCatalogVisible === undefined) {
        invalidParameter("Commerce 设置至少需要 is_cart_enabled 或 is_catalog_visible");
    }
    return {
        ...(isCartEnabled === undefined ? {} : { is_cart_enabled: isCartEnabled }),
        ...(isCatalogVisible === undefined ? {} : { is_catalog_visible: isCatalogVisible }),
    };
}

function optionalBoolean(source: Record<string, unknown>, name: string): boolean | undefined {
    const value = source[name];
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") invalidParameter(`${name} 必须是布尔值`);
    return value;
}

function optionalResponseString(
    source: Record<string, unknown>,
    name: string,
): Record<string, string> {
    const value = source[name];
    if (value === undefined) return {};
    if (typeof value !== "string" || !value) invalidResponse(source);
    return { [name]: value };
}

function optionalResponseBoolean(
    source: Record<string, unknown>,
    name: string,
): Record<string, boolean> {
    const value = source[name];
    if (value === undefined) return {};
    if (typeof value !== "boolean") invalidResponse(source);
    return { [name]: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp Commerce 响应不符合官方结构", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
