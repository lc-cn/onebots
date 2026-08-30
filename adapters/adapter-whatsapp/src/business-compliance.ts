import type { PlatformActionHandler } from "onebots";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";

export const WHATSAPP_BUSINESS_COMPLIANCE_FIELDS = Object.freeze([
    "messaging_product",
    "entity_name",
    "entity_type",
    "entity_type_custom",
    "is_registered",
    "grievance_officer_details",
    "customer_care_details",
] as const);

export type WhatsAppBusinessComplianceField = (typeof WHATSAPP_BUSINESS_COMPLIANCE_FIELDS)[number];

export const WHATSAPP_BUSINESS_ENTITY_TYPES = Object.freeze([
    "LIMITED_LIABILITY_PARTNERSHIP",
    "SOLE_PROPRIETORSHIP",
    "PARTNERSHIP",
    "PUBLIC_COMPANY",
    "PRIVATE_COMPANY",
    "OTHER",
] as const);

export type WhatsAppBusinessEntityType = (typeof WHATSAPP_BUSINESS_ENTITY_TYPES)[number];

export interface WhatsAppComplianceContactDetails {
    email: string;
    mobile_number?: string;
    landline_number?: string;
}

export interface WhatsAppGrievanceOfficerDetails extends WhatsAppComplianceContactDetails {
    name: string;
}

export interface WhatsAppComplianceContactInfo {
    email?: string;
    mobile_number?: string;
    landline_number?: string;
}

export interface WhatsAppGrievanceOfficerInfo extends WhatsAppComplianceContactInfo {
    name?: string;
}

export interface WhatsAppBusinessComplianceInfo {
    whatsapp_business_account_id: string;
    messaging_product?: "whatsapp";
    entity_name?: string | null;
    entity_type?: string | null;
    entity_type_custom?: string | null;
    is_registered?: boolean;
    grievance_officer_details?: WhatsAppGrievanceOfficerInfo | null;
    customer_care_details?: WhatsAppComplianceContactInfo | null;
}

export interface WhatsAppBusinessComplianceResponse {
    data: WhatsAppBusinessComplianceInfo[];
}

export interface WhatsAppBusinessComplianceUpdate {
    entity_name: string;
    entity_type: WhatsAppBusinessEntityType;
    entity_type_custom?: string;
    is_registered?: boolean;
    grievance_officer_details: WhatsAppGrievanceOfficerDetails;
    customer_care_details: WhatsAppComplianceContactDetails;
}

export interface WhatsAppBusinessComplianceUpdateResponse {
    success: true;
}

export const WHATSAPP_BUSINESS_COMPLIANCE_ACTIONS = Object.freeze([
    "get_business_compliance_info",
    "update_business_compliance_info",
] as const);

export type WhatsAppBusinessComplianceAction =
    (typeof WHATSAPP_BUSINESS_COMPLIANCE_ACTIONS)[number];

export function isWhatsAppBusinessComplianceAction(
    action: string,
): action is WhatsAppBusinessComplianceAction {
    return (WHATSAPP_BUSINESS_COMPLIANCE_ACTIONS as readonly string[]).includes(action);
}

/** Business Compliance 强类型读写边界，并执行 Meta 的跨字段校验。 */
export class WhatsAppBusinessCompliance {
    constructor(private readonly client: WhatsAppClient) {}

    async get(
        fields: readonly WhatsAppBusinessComplianceField[] = WHATSAPP_BUSINESS_COMPLIANCE_FIELDS,
    ): Promise<WhatsAppBusinessComplianceResponse> {
        const selected = complianceFields(fields);
        return complianceResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.phone_number_id}/business_compliance_info`,
                query: { fields: selected.join(",") },
            }),
        );
    }

    async update(
        info: WhatsAppBusinessComplianceUpdate,
    ): Promise<WhatsAppBusinessComplianceUpdateResponse> {
        const response = await this.client.call<unknown>({
            method: "POST",
            resource: `${this.client.config.phone_number_id}/business_compliance_info`,
            body: { messaging_product: "whatsapp", ...complianceUpdate(info) },
        });
        if (!isRecord(response) || response.success !== true) invalidResponse(response);
        return { success: true };
    }

    execute(
        action: WhatsAppBusinessComplianceAction,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        switch (action) {
            case "get_business_compliance_info":
                return this.get(actionFields(params));
            case "update_business_compliance_info":
                return this.update(actionUpdate(params));
        }
    }
}

export const WHATSAPP_BUSINESS_COMPLIANCE_ACTION_HANDLERS = Object.fromEntries(
    WHATSAPP_BUSINESS_COMPLIANCE_ACTIONS.map(action => [
        action,
        (client: WhatsAppClient, params: Readonly<Record<string, unknown>>) =>
            client.businessCompliance.execute(action, params),
    ]),
) as Record<WhatsAppBusinessComplianceAction, PlatformActionHandler<WhatsAppClient>>;

function complianceResponse(value: unknown): WhatsAppBusinessComplianceResponse {
    if (!isRecord(value) || !Array.isArray(value.data)) invalidResponse(value);
    return { data: value.data.map(complianceInfo) };
}

function complianceInfo(value: unknown): WhatsAppBusinessComplianceInfo {
    if (!isRecord(value)) invalidResponse(value);
    const accountId = requiredResponseString(value.whatsapp_business_account_id, value);
    if (value.messaging_product !== undefined && value.messaging_product !== "whatsapp") {
        invalidResponse(value);
    }
    return {
        whatsapp_business_account_id: accountId,
        ...optionalMessagingProduct(value),
        ...nullableResponseString(value, "entity_name"),
        ...nullableResponseString(value, "entity_type"),
        ...nullableResponseString(value, "entity_type_custom"),
        ...optionalResponseBoolean(value, "is_registered"),
        ...nullableResponseContact(value, "grievance_officer_details", true),
        ...nullableResponseContact(value, "customer_care_details", false),
    };
}

function complianceUpdate(info: unknown): WhatsAppBusinessComplianceUpdate {
    if (!isRecord(info)) invalidParameter("info 必须是对象");
    rejectUnknown(
        info,
        [
            "entity_name",
            "entity_type",
            "entity_type_custom",
            "is_registered",
            "grievance_officer_details",
            "customer_care_details",
        ],
        "Business Compliance 更新",
    );
    const entityName = boundedText(info.entity_name, "entity_name", 2, 128);
    const entityType = businessEntityType(info.entity_type);
    const entityTypeCustom = optionalBoundedText(
        info.entity_type_custom,
        "entity_type_custom",
        1,
        1024,
    );
    if (entityType === "OTHER" && entityTypeCustom === undefined) {
        invalidParameter("entity_type 为 OTHER 时必须提供 entity_type_custom");
    }
    if (entityType !== "OTHER" && entityTypeCustom !== undefined) {
        invalidParameter("entity_type_custom 只能与 OTHER 一起使用");
    }
    if (info.is_registered !== undefined) {
        if (typeof info.is_registered !== "boolean") invalidParameter("is_registered 必须是布尔值");
        if (entityType !== "OTHER" && entityType !== "PARTNERSHIP") {
            invalidParameter("is_registered 只能用于 OTHER 或 PARTNERSHIP");
        }
    }
    return {
        entity_name: entityName,
        entity_type: entityType,
        ...(entityTypeCustom === undefined ? {} : { entity_type_custom: entityTypeCustom }),
        ...(info.is_registered === undefined ? {} : { is_registered: info.is_registered }),
        grievance_officer_details: contact(info.grievance_officer_details, true),
        customer_care_details: contact(info.customer_care_details, false),
    };
}

function actionFields(
    params: Readonly<Record<string, unknown>>,
): readonly WhatsAppBusinessComplianceField[] {
    if (params.fields === undefined) return WHATSAPP_BUSINESS_COMPLIANCE_FIELDS;
    if (!Array.isArray(params.fields)) invalidParameter("fields 必须是可增减的字段数组");
    return params.fields.map(field => {
        if (typeof field !== "string" || !isComplianceField(field)) {
            invalidParameter(`未知 Business Compliance 字段: ${String(field)}`);
        }
        return field;
    });
}

function actionUpdate(params: Readonly<Record<string, unknown>>): WhatsAppBusinessComplianceUpdate {
    if (!isRecord(params.info)) invalidParameter("info 必须是对象");
    return complianceUpdate(params.info);
}

function complianceFields(
    fields: readonly WhatsAppBusinessComplianceField[],
): WhatsAppBusinessComplianceField[] {
    if (!fields.length) invalidParameter("Business Compliance fields 不能为空");
    const unique = [...new Set(fields)];
    if (unique.some(field => !isComplianceField(field))) {
        invalidParameter("Business Compliance fields 无效");
    }
    return unique;
}

function isComplianceField(value: string): value is WhatsAppBusinessComplianceField {
    return (WHATSAPP_BUSINESS_COMPLIANCE_FIELDS as readonly string[]).includes(value);
}

function businessEntityType(value: unknown): WhatsAppBusinessEntityType {
    if (!isBusinessEntityType(value)) {
        invalidParameter(`未知 entity_type: ${String(value)}`);
    }
    return value;
}

function isBusinessEntityType(value: unknown): value is WhatsAppBusinessEntityType {
    return (
        typeof value === "string" &&
        (WHATSAPP_BUSINESS_ENTITY_TYPES as readonly string[]).includes(value)
    );
}

function contact(value: unknown, grievanceOfficer: true): WhatsAppGrievanceOfficerDetails;
function contact(value: unknown, grievanceOfficer: false): WhatsAppComplianceContactDetails;
function contact(
    value: unknown,
    grievanceOfficer: boolean,
): WhatsAppGrievanceOfficerDetails | WhatsAppComplianceContactDetails {
    const name = grievanceOfficer ? "grievance_officer_details" : "customer_care_details";
    if (!isRecord(value)) invalidParameter(`${name} 必须是对象`);
    rejectUnknown(
        value,
        grievanceOfficer
            ? ["name", "email", "mobile_number", "landline_number"]
            : ["email", "mobile_number", "landline_number"],
        name,
    );
    const details = {
        email: email(value.email, `${name}.email`),
        ...optionalPhone(value.mobile_number, `${name}.mobile_number`, "mobile_number"),
        ...optionalPhone(value.landline_number, `${name}.landline_number`, "landline_number"),
    };
    return grievanceOfficer
        ? { name: boundedText(value.name, `${name}.name`, 1, 128), ...details }
        : details;
}

function nullableResponseContact(
    source: Record<string, unknown>,
    name: string,
    grievanceOfficer: boolean,
): Record<string, WhatsAppGrievanceOfficerInfo | WhatsAppComplianceContactInfo | null> {
    const value = source[name];
    if (value === undefined) return {};
    if (value === null) return { [name]: null };
    if (!isRecord(value)) invalidResponse(source);
    const result: WhatsAppComplianceContactInfo = {
        ...optionalResponseEmail(value, source),
        ...optionalResponsePhone(value, "mobile_number", source),
        ...optionalResponsePhone(value, "landline_number", source),
    };
    return grievanceOfficer
        ? { [name]: { ...optionalResponseText(value, "name", 128, source), ...result } }
        : { [name]: result };
}

function optionalMessagingProduct(source: Record<string, unknown>): {
    messaging_product?: "whatsapp";
} {
    return source.messaging_product === "whatsapp" ? { messaging_product: "whatsapp" } : {};
}

function nullableResponseString(
    source: Record<string, unknown>,
    name: string,
): Record<string, string | null> {
    const value = source[name];
    if (value === undefined) return {};
    if (value !== null && typeof value !== "string") invalidResponse(source);
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

function boundedText(value: unknown, name: string, min: number, max: number): string {
    if (typeof value !== "string" || value.trim().length < min || value.length > max) {
        invalidParameter(`${name} 长度必须为 ${min}-${max}`);
    }
    return value;
}

function optionalBoundedText(
    value: unknown,
    name: string,
    min: number,
    max: number,
): string | undefined {
    return value === undefined ? undefined : boundedText(value, name, min, max);
}

function email(value: unknown, name: string): string {
    const result = boundedText(value, name, 1, 128);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(result)) invalidParameter(`${name} 必须是有效邮箱地址`);
    return result;
}

function optionalPhone(value: unknown, name: string, key: string): Record<string, string> {
    if (value === undefined) return {};
    if (typeof value !== "string" || !/^\+[1-9]\d{1,14}$/u.test(value)) {
        invalidParameter(`${name} 必须是带国家码的 E.164 号码`);
    }
    return { [key]: value };
}

function optionalResponseText(
    source: Record<string, unknown>,
    name: string,
    max: number,
    details: unknown,
): Record<string, string> {
    const value = source[name];
    if (value === undefined) return {};
    if (typeof value !== "string" || !value || value.length > max) invalidResponse(details);
    return { [name]: value };
}

function optionalResponseEmail(
    source: Record<string, unknown>,
    details: unknown,
): { email?: string } {
    const value = source.email;
    if (value === undefined) return {};
    if (
        typeof value !== "string" ||
        !value ||
        value.length > 128 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
    ) {
        invalidResponse(details);
    }
    return { email: value };
}

function optionalResponsePhone(
    source: Record<string, unknown>,
    name: string,
    details: unknown,
): Record<string, string> {
    const value = source[name];
    if (value === undefined) return {};
    if (typeof value !== "string" || !/^\+[1-9]\d{1,14}$/u.test(value)) invalidResponse(details);
    return { [name]: value };
}

function requiredResponseString(value: unknown, details: unknown): string {
    if (typeof value !== "string" || !value) invalidResponse(details);
    return value;
}

function rejectUnknown(
    source: Record<string, unknown>,
    allowed: readonly string[],
    name: string,
): void {
    const allowedSet = new Set(allowed);
    const unknown = Object.keys(source).find(key => !allowedSet.has(key));
    if (unknown) invalidParameter(`${name} 包含未知字段: ${unknown}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp Business Compliance 响应不符合官方结构", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
