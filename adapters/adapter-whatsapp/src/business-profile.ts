import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";

export const WHATSAPP_BUSINESS_PROFILE_FIELDS = Object.freeze([
    "messaging_product",
    "about",
    "address",
    "description",
    "email",
    "profile_picture_url",
    "websites",
    "vertical",
] as const);

export type WhatsAppBusinessProfileField = (typeof WHATSAPP_BUSINESS_PROFILE_FIELDS)[number];

export const WHATSAPP_BUSINESS_VERTICALS = Object.freeze([
    "OTHER",
    "AUTO",
    "BEAUTY",
    "APPAREL",
    "EDU",
    "ENTERTAIN",
    "EVENT_PLAN",
    "FINANCE",
    "GROCERY",
    "GOVT",
    "HOTEL",
    "HEALTH",
    "NONPROFIT",
    "PROF_SERVICES",
    "RETAIL",
    "TRAVEL",
    "RESTAURANT",
    "ALCOHOL",
    "ONLINE_GAMBLING",
    "PHYSICAL_GAMBLING",
    "OTC_DRUGS",
] as const);

export type WhatsAppBusinessVertical = (typeof WHATSAPP_BUSINESS_VERTICALS)[number];

export interface WhatsAppBusinessProfile {
    messaging_product: "whatsapp";
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    profile_picture_url?: string;
    websites?: string[];
    vertical?: WhatsAppBusinessVertical;
}

export interface WhatsAppBusinessProfileResponse {
    data: Array<{ business_profile: WhatsAppBusinessProfile }>;
}

export interface WhatsAppBusinessProfileUpdate {
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    profile_picture_handle?: string;
    websites?: readonly string[];
    vertical?: WhatsAppBusinessVertical;
}

export interface WhatsAppBusinessProfileUpdateResponse {
    success: true;
}

const BUSINESS_PROFILE_UPDATE_FIELDS = Object.freeze([
    "about",
    "address",
    "description",
    "email",
    "profile_picture_handle",
    "websites",
    "vertical",
] as const);

/** WhatsApp Business Profile 强类型读取与受控更新边界。 */
export class WhatsAppBusinessProfiles {
    constructor(private readonly client: WhatsAppClient) {}

    async get(
        fields: readonly WhatsAppBusinessProfileField[] = WHATSAPP_BUSINESS_PROFILE_FIELDS,
    ): Promise<WhatsAppBusinessProfileResponse> {
        const selected = profileFields(fields);
        return profileResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.phone_number_id}/whatsapp_business_profile`,
                query: { fields: selected.join(",") },
            }),
        );
    }

    async update(
        profile: WhatsAppBusinessProfileUpdate,
    ): Promise<WhatsAppBusinessProfileUpdateResponse> {
        const body = profileUpdate(profile);
        const response = await this.client.call<unknown>({
            method: "POST",
            resource: `${this.client.config.phone_number_id}/whatsapp_business_profile`,
            body: { messaging_product: "whatsapp", ...body },
        });
        if (!isRecord(response) || response.success !== true) invalidResponse(response);
        return { success: true };
    }
}

type BusinessProfileActionParams = Readonly<Record<string, unknown>>;

const BUSINESS_PROFILE_ACTION_HANDLERS = {
    get_business_profile: (client: WhatsAppClient, params: BusinessProfileActionParams) =>
        client.businessProfile.get(actionFields(params)),
    update_business_profile: (client: WhatsAppClient, params: BusinessProfileActionParams) =>
        client.businessProfile.update(actionUpdate(params)),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Business Profile 动作的执行与参数契约单一来源。 */
export const WHATSAPP_BUSINESS_PROFILE_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    BUSINESS_PROFILE_ACTION_HANDLERS,
    {
        get_business_profile: ["fields"],
        update_business_profile: ["profile"],
    },
);

export type WhatsAppBusinessProfileAction = keyof typeof WHATSAPP_BUSINESS_PROFILE_ACTION_HANDLERS;

export function isWhatsAppBusinessProfileAction(
    action: string,
): action is WhatsAppBusinessProfileAction {
    return Object.hasOwn(WHATSAPP_BUSINESS_PROFILE_ACTION_HANDLERS, action);
}

function profileResponse(value: unknown): WhatsAppBusinessProfileResponse {
    if (!isRecord(value) || !Array.isArray(value.data)) invalidResponse(value);
    return {
        data: value.data.map(item => {
            if (!isRecord(item)) invalidResponse(item);
            return { business_profile: profileValue(item.business_profile) };
        }),
    };
}

function profileValue(value: unknown): WhatsAppBusinessProfile {
    if (!isRecord(value) || value.messaging_product !== "whatsapp") invalidResponse(value);
    return {
        messaging_product: "whatsapp",
        ...optionalTextResponse(value, "about", 139),
        ...optionalTextResponse(value, "address", 256, true),
        ...optionalTextResponse(value, "description", 256, true),
        ...optionalEmailResponse(value),
        ...optionalUrlResponse(value, "profile_picture_url"),
        ...optionalWebsitesResponse(value),
        ...optionalVerticalResponse(value),
    };
}

function profileUpdate(profile: WhatsAppBusinessProfileUpdate): Record<string, unknown> {
    rejectUnknownProfileFields(profile);
    const result: Record<string, unknown> = {};
    addOptionalText(result, "about", profile.about, 139, false);
    addOptionalText(result, "address", profile.address, 256, true);
    addOptionalText(result, "description", profile.description, 256, true);
    addOptionalText(result, "email", profile.email, 128, true);
    if (profile.email) email(profile.email);
    addOptionalText(result, "profile_picture_handle", profile.profile_picture_handle, 2048, false);
    if (profile.websites !== undefined) result.websites = websites(profile.websites);
    if (profile.vertical !== undefined) result.vertical = vertical(profile.vertical);
    if (!Object.keys(result).length) invalidParameter("Business Profile 更新不能为空");
    return result;
}

function actionFields(
    params: Readonly<Record<string, unknown>>,
): readonly WhatsAppBusinessProfileField[] {
    const value = params.fields;
    if (value === undefined) return WHATSAPP_BUSINESS_PROFILE_FIELDS;
    if (!Array.isArray(value)) invalidParameter("fields 必须是可增减的字段数组");
    return value.map(item => {
        if (typeof item !== "string" || !isProfileField(item)) {
            invalidParameter(`未知 Business Profile 字段: ${String(item)}`);
        }
        return item;
    });
}

function actionUpdate(params: Readonly<Record<string, unknown>>): WhatsAppBusinessProfileUpdate {
    const value = params.profile;
    if (!isRecord(value)) invalidParameter("profile 必须是对象");
    rejectUnknownProfileFields(value);
    return {
        ...actionOptionalText(value, "about"),
        ...actionOptionalText(value, "address"),
        ...actionOptionalText(value, "description"),
        ...actionOptionalText(value, "email"),
        ...actionOptionalText(value, "profile_picture_handle"),
        ...actionWebsites(value),
        ...actionVertical(value),
    };
}

function rejectUnknownProfileFields(value: object): void {
    const unknown = Object.keys(value).find(
        name => !(BUSINESS_PROFILE_UPDATE_FIELDS as readonly string[]).includes(name),
    );
    if (unknown) invalidParameter(`未知 Business Profile 更新字段: ${unknown}`);
}

function profileFields(
    fields: readonly WhatsAppBusinessProfileField[],
): WhatsAppBusinessProfileField[] {
    if (!fields.length) invalidParameter("Business Profile fields 不能为空");
    const unique = [...new Set(fields)];
    if (unique.some(field => !isProfileField(field)))
        invalidParameter("Business Profile fields 无效");
    return unique;
}

function isProfileField(value: string): value is WhatsAppBusinessProfileField {
    return (WHATSAPP_BUSINESS_PROFILE_FIELDS as readonly string[]).includes(value);
}

function vertical(value: string): WhatsAppBusinessVertical {
    if (!isBusinessVertical(value)) {
        invalidParameter(`未知 Business Profile vertical: ${value}`);
    }
    return value;
}

function isBusinessVertical(value: string): value is WhatsAppBusinessVertical {
    return (WHATSAPP_BUSINESS_VERTICALS as readonly string[]).includes(value);
}

function websites(values: readonly string[]): string[] {
    if (values.length > 2) invalidParameter("Business Profile websites 最多 2 个");
    return values.map((value, index) => url(value, `websites[${index}]`, 256));
}

function addOptionalText(
    target: Record<string, unknown>,
    name: string,
    value: string | undefined,
    maxLength: number,
    allowEmpty: boolean,
): void {
    if (value === undefined) return;
    if ((!allowEmpty && !value) || value.length > maxLength) {
        invalidParameter(`${name} 长度必须为 ${allowEmpty ? `0-${maxLength}` : `1-${maxLength}`}`);
    }
    target[name] = value;
}

function optionalTextResponse(
    source: Record<string, unknown>,
    name: string,
    maxLength: number,
    allowEmpty = false,
): Record<string, string> {
    const value = source[name];
    if (value === undefined) return {};
    if (typeof value !== "string" || (!allowEmpty && !value) || value.length > maxLength) {
        invalidResponse(source);
    }
    return { [name]: value };
}

function optionalEmailResponse(source: Record<string, unknown>): Record<string, string> {
    const value = source.email;
    if (value === undefined) return {};
    if (typeof value !== "string" || value.length > 128 || (value !== "" && !isEmail(value))) {
        invalidResponse(source);
    }
    return { email: value };
}

function optionalUrlResponse(
    source: Record<string, unknown>,
    name: string,
): Record<string, string> {
    const value = source[name];
    if (value === undefined) return {};
    if (typeof value !== "string" || !isHttpUrl(value)) invalidResponse(source);
    return { [name]: value };
}

function optionalWebsitesResponse(source: Record<string, unknown>): { websites?: string[] } {
    if (source.websites === undefined) return {};
    if (!isStringArray(source.websites)) invalidResponse(source);
    if (
        source.websites.length > 2 ||
        source.websites.some(value => value.length > 256 || !isHttpUrl(value))
    ) {
        invalidResponse(source);
    }
    return { websites: source.websites };
}

function optionalVerticalResponse(source: Record<string, unknown>): {
    vertical?: WhatsAppBusinessVertical;
} {
    if (source.vertical === undefined) return {};
    if (typeof source.vertical !== "string" || !isBusinessVertical(source.vertical)) {
        invalidResponse(source);
    }
    return { vertical: source.vertical };
}

function actionOptionalText(source: Record<string, unknown>, name: string): Record<string, string> {
    const value = source[name];
    if (value === undefined) return {};
    if (typeof value !== "string") invalidParameter(`${name} 必须是字符串`);
    return { [name]: value };
}

function actionWebsites(source: Record<string, unknown>): { websites?: string[] } {
    if (source.websites === undefined) return {};
    if (!isStringArray(source.websites)) invalidParameter("websites 必须是字符串数组");
    return { websites: source.websites };
}

function actionVertical(source: Record<string, unknown>): { vertical?: WhatsAppBusinessVertical } {
    if (source.vertical === undefined) return {};
    if (typeof source.vertical !== "string") invalidParameter("vertical 必须是字符串");
    return { vertical: vertical(source.vertical) };
}

function email(value: string): string {
    if (value.length > 128 || !isEmail(value)) {
        invalidParameter("email 必须是最长 128 字符的有效邮箱地址");
    }
    return value;
}

function url(value: string, name: string, maxLength = 2048): string {
    if (value.length > maxLength || !isHttpUrl(value))
        invalidParameter(`${name} 必须是 HTTP(S) URL`);
    return value;
}

function isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function isHttpUrl(value: string): boolean {
    if (!URL.canParse(value)) return false;
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === "string");
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp Business Profile 响应不符合官方结构", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
