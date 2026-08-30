import type { PlatformActionHandler } from "onebots";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import {
    WHATSAPP_OFFICIAL_BUSINESS_ACCOUNT_ACTIONS,
    WHATSAPP_OFFICIAL_BUSINESS_ACCOUNT_STATUSES,
    type WhatsAppOfficialBusinessAccountAction,
    type WhatsAppOfficialBusinessAccountApplication,
    type WhatsAppOfficialBusinessAccountApplicationResponse,
    type WhatsAppOfficialBusinessAccountStatus,
    type WhatsAppOfficialBusinessAccountStatusName,
} from "./official-business-account-types.js";

export * from "./official-business-account-types.js";

export function isWhatsAppOfficialBusinessAccountAction(
    action: string,
): action is WhatsAppOfficialBusinessAccountAction {
    return (WHATSAPP_OFFICIAL_BUSINESS_ACCOUNT_ACTIONS as readonly string[]).includes(action);
}

/** 当前 Phone Number 的 OBA 审核状态与申请提交边界。 */
export class WhatsAppOfficialBusinessAccount {
    constructor(private readonly client: WhatsAppClient) {}

    async getStatus(): Promise<WhatsAppOfficialBusinessAccountStatus> {
        return statusResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.phone_number_id}/official_business_account`,
                query: { fields: "oba_status,status_message" },
            }),
        );
    }

    async submitApplication(
        application: WhatsAppOfficialBusinessAccountApplication,
    ): Promise<WhatsAppOfficialBusinessAccountApplicationResponse> {
        return applicationResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.phone_number_id}/official_business_account`,
                body: applicationRequest(application),
            }),
        );
    }

    execute(
        action: WhatsAppOfficialBusinessAccountAction,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        switch (action) {
            case "get_official_business_account_status":
                rejectUnknown(params, []);
                return this.getStatus();
            case "submit_official_business_account_application":
                rejectUnknown(params, ["application"]);
                return this.submitApplication(applicationRequest(params.application));
        }
    }
}

export const WHATSAPP_OFFICIAL_BUSINESS_ACCOUNT_ACTION_HANDLERS = Object.fromEntries(
    WHATSAPP_OFFICIAL_BUSINESS_ACCOUNT_ACTIONS.map(action => [
        action,
        (client: WhatsAppClient, params: Readonly<Record<string, unknown>>) =>
            client.officialBusinessAccount.execute(action, params),
    ]),
) as Record<WhatsAppOfficialBusinessAccountAction, PlatformActionHandler<WhatsAppClient>>;

function applicationRequest(value: unknown): WhatsAppOfficialBusinessAccountApplication {
    const source = inputRecord(value, "application");
    rejectUnknown(source, [
        "business_website_url",
        "primary_country_of_operation",
        "primary_language",
        "parent_business_or_brand",
        "supporting_links",
        "additional_supporting_information",
    ]);
    return {
        business_website_url: httpsUrl(source.business_website_url, "business_website_url"),
        primary_country_of_operation: countryCode(source.primary_country_of_operation),
        ...(source.primary_language === undefined
            ? {}
            : { primary_language: locale(source.primary_language) }),
        ...(source.parent_business_or_brand === undefined
            ? {}
            : {
                  parent_business_or_brand: boundedText(
                      source.parent_business_or_brand,
                      "parent_business_or_brand",
                      255,
                  ),
              }),
        ...(source.supporting_links === undefined
            ? {}
            : { supporting_links: supportingLinks(source.supporting_links) }),
        ...(source.additional_supporting_information === undefined
            ? {}
            : {
                  additional_supporting_information: boundedText(
                      source.additional_supporting_information,
                      "additional_supporting_information",
                      1000,
                  ),
              }),
    };
}

function supportingLinks(value: unknown): string[] {
    if (!Array.isArray(value) || value.length < 5 || value.length > 10) {
        invalidParameter("supporting_links 必须包含 5 到 10 条链接");
    }
    const links = value.map((link, index) => httpsUrl(link, `supporting_links[${index}]`));
    if (new Set(links).size !== links.length) invalidParameter("supporting_links 不能重复");
    return links;
}

function httpsUrl(value: unknown, name: string): string {
    const text = inputText(value, name);
    if (!URL.canParse(text)) invalidParameter(`${name} 必须是有效 HTTPS URL`);
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password) {
        invalidParameter(`${name} 必须是无凭据的 HTTPS URL`);
    }
    return url.href;
}

function countryCode(value: unknown): string {
    const text = inputText(value, "primary_country_of_operation").toUpperCase();
    if (!/^[A-Z]{2}$/u.test(text)) {
        invalidParameter("primary_country_of_operation 必须是 ISO 3166-1 alpha-2 国家码");
    }
    return text;
}

function locale(value: unknown): string {
    const text = inputText(value, "primary_language");
    if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/u.test(text)) {
        invalidParameter("primary_language 必须是语言码或 language_COUNTRY locale");
    }
    return text;
}

function statusResponse(value: unknown): WhatsAppOfficialBusinessAccountStatus {
    const source = responseRecord(value, "OBA 状态响应");
    return {
        id: responseText(source.id, "id"),
        oba_status: responseStatus(source.oba_status),
        status_message: responseText(source.status_message, "status_message"),
    };
}

function applicationResponse(value: unknown): WhatsAppOfficialBusinessAccountApplicationResponse {
    const source = responseRecord(value, "OBA 申请响应");
    if (typeof source.success !== "boolean") invalidResponse("success 必须是布尔值");
    return {
        success: source.success,
        message: responseText(source.message, "message"),
        ...(source.updated_status === undefined
            ? {}
            : { updated_status: statusResponse(source.updated_status) }),
        ...(source.tracking_id === undefined
            ? {}
            : { tracking_id: responseText(source.tracking_id, "tracking_id") }),
    };
}

function responseStatus(value: unknown): WhatsAppOfficialBusinessAccountStatusName {
    if (
        typeof value !== "string" ||
        !(WHATSAPP_OFFICIAL_BUSINESS_ACCOUNT_STATUSES as readonly string[]).includes(value)
    ) {
        invalidResponse(`不支持 oba_status: ${String(value)}`);
    }
    return value as WhatsAppOfficialBusinessAccountStatusName;
}

function inputRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        invalidParameter(`${name} 必须是对象`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function responseRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        invalidResponse(`${name} 必须是对象`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function inputText(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 必须是非空字符串`);
    return value.trim();
}

function boundedText(value: unknown, name: string, maxLength: number): string {
    const text = inputText(value, name);
    if (text.length > maxLength) invalidParameter(`${name} 不能超过 ${maxLength} 个字符`);
    return text;
}

function responseText(value: unknown, name: string): string {
    if (typeof value !== "string" || !value) invalidResponse(`${name} 必须是非空字符串`);
    return value;
}

function rejectUnknown(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) invalidParameter(`不支持字段: ${unknown.join(", ")}`);
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}

function invalidResponse(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_RESPONSE" });
}
