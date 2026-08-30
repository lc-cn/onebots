import type { PlatformActionHandler } from "onebots";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import {
    WHATSAPP_BUSINESS_PHONE_NUMBER_ACCOUNT_MODES,
    WHATSAPP_BUSINESS_PHONE_NUMBER_ACTIONS,
    WHATSAPP_BUSINESS_PHONE_NUMBER_CERT_STATUSES,
    WHATSAPP_BUSINESS_PHONE_NUMBER_FIELDS,
    WHATSAPP_BUSINESS_PHONE_NUMBER_HOST_PLATFORMS,
    WHATSAPP_BUSINESS_PHONE_NUMBER_MESSAGING_TIERS,
    WHATSAPP_BUSINESS_PHONE_NUMBER_QUALITY_RATINGS,
    WHATSAPP_BUSINESS_PHONE_NUMBER_SORTS,
    WHATSAPP_BUSINESS_PHONE_NUMBER_STATUSES,
    type WhatsAppBusinessPhoneNumber,
    type WhatsAppBusinessPhoneNumberAction,
    type WhatsAppBusinessPhoneNumberCreateRequest,
    type WhatsAppBusinessPhoneNumberCreateResponse,
    type WhatsAppBusinessPhoneNumberField,
    type WhatsAppBusinessPhoneNumberFilter,
    type WhatsAppBusinessPhoneNumbersQuery,
    type WhatsAppBusinessPhoneNumbersResponse,
} from "./business-phone-number-types.js";

export function isWhatsAppBusinessPhoneNumberAction(
    action: string,
): action is WhatsAppBusinessPhoneNumberAction {
    return (WHATSAPP_BUSINESS_PHONE_NUMBER_ACTIONS as readonly string[]).includes(action);
}

/** WABA 号码资产清单与入驻创建；不承载当前运行号码的注册和验证码生命周期。 */
export class WhatsAppBusinessPhoneNumbers {
    constructor(private readonly client: WhatsAppClient) {}

    async list(
        query: WhatsAppBusinessPhoneNumbersQuery = {},
    ): Promise<WhatsAppBusinessPhoneNumbersResponse> {
        const normalized = listQuery(query);
        return listResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.business_account_id}/phone_numbers`,
                query: {
                    fields: normalized.fields.join(","),
                    filtering: normalized.filters ? JSON.stringify(normalized.filters) : undefined,
                    sort: normalized.sort,
                    limit: normalized.limit,
                    after: normalized.after,
                    before: normalized.before,
                },
            }),
            normalized.fields,
        );
    }

    async create(
        request: WhatsAppBusinessPhoneNumberCreateRequest,
    ): Promise<WhatsAppBusinessPhoneNumberCreateResponse> {
        return createResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.business_account_id}/phone_numbers`,
                body: createRequest(request),
            }),
        );
    }

    execute(
        action: WhatsAppBusinessPhoneNumberAction,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        switch (action) {
            case "list_business_phone_numbers":
                rejectUnknown(params, ["query"]);
                return this.list(params.query === undefined ? {} : queryInput(params.query));
            case "create_business_phone_number":
                rejectUnknown(params, ["request"]);
                return this.create(createRequest(params.request));
        }
    }
}

export const WHATSAPP_BUSINESS_PHONE_NUMBER_ACTION_HANDLERS = Object.fromEntries(
    WHATSAPP_BUSINESS_PHONE_NUMBER_ACTIONS.map(action => [
        action,
        (client: WhatsAppClient, params: Readonly<Record<string, unknown>>) =>
            client.businessPhoneNumbers.execute(action, params),
    ]),
) as Record<WhatsAppBusinessPhoneNumberAction, PlatformActionHandler<WhatsAppClient>>;

function queryInput(value: unknown): WhatsAppBusinessPhoneNumbersQuery {
    const source = inputRecord(value, "query");
    rejectUnknown(source, ["fields", "filters", "sort", "limit", "after", "before"]);
    return {
        ...(source.fields === undefined ? {} : { fields: selectedFields(source.fields) }),
        ...(source.filters === undefined ? {} : { filters: selectedFilters(source.filters) }),
        ...(source.sort === undefined ? {} : { sort: selectedSort(source.sort) }),
        ...(source.limit === undefined ? {} : { limit: numberInput(source.limit, "limit") }),
        ...(source.after === undefined ? {} : { after: inputText(source.after, "after") }),
        ...(source.before === undefined ? {} : { before: inputText(source.before, "before") }),
    };
}

function listQuery(query: WhatsAppBusinessPhoneNumbersQuery): {
    fields: WhatsAppBusinessPhoneNumberField[];
    filters?: WhatsAppBusinessPhoneNumberFilter[];
    sort?: WhatsAppBusinessPhoneNumbersQuery["sort"];
    limit?: number;
    after?: string;
    before?: string;
} {
    rejectUnknown(inputRecord(query, "query"), [
        "fields",
        "filters",
        "sort",
        "limit",
        "after",
        "before",
    ]);
    if (
        query.limit !== undefined &&
        (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)
    ) {
        invalidParameter("limit 必须是 1 到 100 的整数");
    }
    if (query.after && query.before) invalidParameter("after 与 before 不能同时使用");
    return {
        fields: selectedFields(query.fields || WHATSAPP_BUSINESS_PHONE_NUMBER_FIELDS),
        filters: query.filters ? selectedFilters(query.filters) : undefined,
        sort: query.sort === undefined ? undefined : selectedSort(query.sort),
        limit: query.limit,
        after: optionalText(query.after, "after"),
        before: optionalText(query.before, "before"),
    };
}

function createRequest(value: unknown): WhatsAppBusinessPhoneNumberCreateRequest {
    const source = inputRecord(value, "request");
    rejectUnknown(source, [
        "phone_number",
        "verified_name",
        "cc",
        "migrate_phone_number",
        "preverified_id",
    ]);
    const phoneNumber = inputText(source.phone_number, "phone_number");
    if (!/^[1-9]\d{6,14}$/u.test(phoneNumber)) {
        invalidParameter("phone_number 必须是不含 + 的 E.164 号码");
    }
    const verifiedName = boundedText(source.verified_name, "verified_name", 2, 75);
    const cc = source.cc === undefined ? undefined : inputText(source.cc, "cc");
    if (cc && !/^\d{1,3}$/u.test(cc)) invalidParameter("cc 必须是 1 到 3 位国家拨号代码");
    if (cc && !phoneNumber.startsWith(cc)) invalidParameter("phone_number 必须以 cc 开头");
    const migrate = optionalBoolean(source.migrate_phone_number, "migrate_phone_number");
    const preverifiedId =
        source.preverified_id === undefined
            ? undefined
            : boundedText(source.preverified_id, "preverified_id", 1, 128);
    return {
        phone_number: phoneNumber,
        verified_name: verifiedName,
        ...(cc ? { cc } : {}),
        ...(migrate === undefined ? {} : { migrate_phone_number: migrate }),
        ...(preverifiedId ? { preverified_id: preverifiedId } : {}),
    };
}

function selectedFields(value: unknown): WhatsAppBusinessPhoneNumberField[] {
    if (!Array.isArray(value) || !value.length) invalidParameter("fields 必须是非空数组");
    const fields = value.map(field => {
        if (
            typeof field !== "string" ||
            !(WHATSAPP_BUSINESS_PHONE_NUMBER_FIELDS as readonly string[]).includes(field)
        ) {
            invalidParameter(`不支持 Business Phone Number 字段: ${String(field)}`);
        }
        return field as WhatsAppBusinessPhoneNumberField;
    });
    return [
        ...new Set(["id" as const, "display_phone_number" as const, "status" as const, ...fields]),
    ];
}

function selectedFilters(value: unknown): WhatsAppBusinessPhoneNumberFilter[] {
    if (!Array.isArray(value) || !value.length || value.length > 3) {
        invalidParameter("filters 必须是包含 1 到 3 项的数组");
    }
    const filters = value.map((item, index) => filterInput(item, index));
    if (new Set(filters.map(filter => filter.field)).size !== filters.length) {
        invalidParameter("filters 中的 field 不能重复");
    }
    return filters;
}

function filterInput(value: unknown, index: number): WhatsAppBusinessPhoneNumberFilter {
    const source = inputRecord(value, `filters[${index}]`);
    rejectUnknown(source, ["field", "operator", "value"]);
    if (source.operator !== "EQUAL") invalidParameter(`filters[${index}].operator 仅支持 EQUAL`);
    if (source.field === "account_mode") {
        return {
            field: "account_mode",
            operator: "EQUAL",
            value: inputEnum(
                source.value,
                WHATSAPP_BUSINESS_PHONE_NUMBER_ACCOUNT_MODES,
                `filters[${index}].value`,
            ),
        };
    }
    if (source.field === "messaging_limit_tier") {
        return {
            field: "messaging_limit_tier",
            operator: "EQUAL",
            value: inputEnum(
                source.value,
                WHATSAPP_BUSINESS_PHONE_NUMBER_MESSAGING_TIERS,
                `filters[${index}].value`,
            ),
        };
    }
    if (source.field === "is_official_business_account") {
        if (typeof source.value !== "boolean")
            invalidParameter(`filters[${index}].value 必须是布尔值`);
        return { field: "is_official_business_account", operator: "EQUAL", value: source.value };
    }
    return invalidParameter(`不支持 filters[${index}].field: ${String(source.field)}`);
}

function selectedSort(value: unknown): WhatsAppBusinessPhoneNumbersQuery["sort"] {
    return inputEnum(value, WHATSAPP_BUSINESS_PHONE_NUMBER_SORTS, "sort");
}

function listResponse(
    value: unknown,
    fields: readonly WhatsAppBusinessPhoneNumberField[],
): WhatsAppBusinessPhoneNumbersResponse {
    const source = responseRecord(value, value);
    if (!Array.isArray(source.data)) invalidResponse(value);
    return {
        data: source.data.map(item => phoneNumberResponse(item, fields, value)),
        ...(source.paging === undefined ? {} : { paging: pagingResponse(source.paging, value) }),
    };
}

function phoneNumberResponse(
    value: unknown,
    fields: readonly WhatsAppBusinessPhoneNumberField[],
    root: unknown,
): WhatsAppBusinessPhoneNumber {
    const source = responseRecord(value, root);
    const result: WhatsAppBusinessPhoneNumber = {
        id: responseNumericId(source.id, root),
        display_phone_number: responseText(source.display_phone_number, root),
        status: responseEnum(source.status, WHATSAPP_BUSINESS_PHONE_NUMBER_STATUSES, root),
    };
    assignText(result, source, fields, "verified_name", root);
    assignEnum(
        result,
        source,
        fields,
        "quality_rating",
        WHATSAPP_BUSINESS_PHONE_NUMBER_QUALITY_RATINGS,
        root,
    );
    assignText(result, source, fields, "country_code", root);
    assignText(result, source, fields, "country_dial_code", root);
    assignEnum(
        result,
        source,
        fields,
        "code_verification_status",
        ["VERIFIED", "NOT_VERIFIED"],
        root,
    );
    assignEnum(
        result,
        source,
        fields,
        "unified_cert_status",
        WHATSAPP_BUSINESS_PHONE_NUMBER_CERT_STATUSES,
        root,
    );
    assignEnum(
        result,
        source,
        fields,
        "account_mode",
        WHATSAPP_BUSINESS_PHONE_NUMBER_ACCOUNT_MODES,
        root,
    );
    assignEnum(
        result,
        source,
        fields,
        "host_platform",
        WHATSAPP_BUSINESS_PHONE_NUMBER_HOST_PLATFORMS,
        root,
    );
    assignEnum(
        result,
        source,
        fields,
        "messaging_limit_tier",
        WHATSAPP_BUSINESS_PHONE_NUMBER_MESSAGING_TIERS,
        root,
    );
    if (
        fields.includes("is_official_business_account") &&
        source.is_official_business_account !== undefined
    ) {
        if (typeof source.is_official_business_account !== "boolean") invalidResponse(root);
        result.is_official_business_account = source.is_official_business_account;
    }
    if (fields.includes("username") && source.username !== undefined) {
        if (
            source.username !== null &&
            (typeof source.username !== "string" || !source.username.trim())
        )
            invalidResponse(root);
        result.username = source.username;
    }
    return result;
}

function assignText<T extends "verified_name" | "country_code" | "country_dial_code">(
    target: WhatsAppBusinessPhoneNumber,
    source: Readonly<Record<string, unknown>>,
    fields: readonly WhatsAppBusinessPhoneNumberField[],
    field: T,
    root: unknown,
): void {
    if (fields.includes(field) && source[field] !== undefined)
        target[field] = responseText(source[field], root);
}

function assignEnum<
    T extends
        | "quality_rating"
        | "code_verification_status"
        | "unified_cert_status"
        | "account_mode"
        | "host_platform"
        | "messaging_limit_tier",
>(
    target: WhatsAppBusinessPhoneNumber,
    source: Readonly<Record<string, unknown>>,
    fields: readonly WhatsAppBusinessPhoneNumberField[],
    field: T,
    allowed: readonly NonNullable<WhatsAppBusinessPhoneNumber[T]>[],
    root: unknown,
): void {
    if (fields.includes(field) && source[field] !== undefined) {
        target[field] = responseEnum(source[field], allowed, root);
    }
}

function pagingResponse(
    value: unknown,
    root: unknown,
): WhatsAppBusinessPhoneNumbersResponse["paging"] {
    const source = responseRecord(value, root);
    const cursors = source.cursors === undefined ? undefined : responseRecord(source.cursors, root);
    return {
        ...(cursors ? { cursors: optionalCursorPair(cursors, root) } : {}),
        ...(source.previous === undefined
            ? {}
            : { previous: responseHttpsUrl(source.previous, root) }),
        ...(source.next === undefined ? {} : { next: responseHttpsUrl(source.next, root) }),
    };
}

function optionalCursorPair(
    source: Readonly<Record<string, unknown>>,
    root: unknown,
): { before?: string; after?: string } {
    return {
        ...(source.before === undefined ? {} : { before: responseText(source.before, root) }),
        ...(source.after === undefined ? {} : { after: responseText(source.after, root) }),
    };
}

function createResponse(value: unknown): WhatsAppBusinessPhoneNumberCreateResponse {
    const source = responseRecord(value, value);
    return { id: responseNumericId(source.id, value) };
}

function inputEnum<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) {
        invalidParameter(`${name} 不是受支持的值: ${String(value)}`);
    }
    return value as T;
}

function responseEnum<T extends string>(value: unknown, allowed: readonly T[], root: unknown): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) invalidResponse(root);
    return value as T;
}

function responseHttpsUrl(value: unknown, root: unknown): string {
    const text = responseText(value, root);
    if (!URL.canParse(text)) invalidResponse(root);
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password) invalidResponse(root);
    return text;
}

function optionalText(value: unknown, name: string): string | undefined {
    return value === undefined ? undefined : inputText(value, name);
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") invalidParameter(`${name} 必须是布尔值`);
    return value;
}

function numberInput(value: unknown, name: string): number {
    if (typeof value !== "number") invalidParameter(`${name} 必须是数字`);
    return value;
}

function boundedText(value: unknown, name: string, min: number, max: number): string {
    const text = inputText(value, name);
    const length = [...text].length;
    if (length < min || length > max) invalidParameter(`${name} 长度必须为 ${min} 到 ${max}`);
    return text;
}

function inputText(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function inputRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        invalidParameter(`${name} 必须是对象`);
    return value as Readonly<Record<string, unknown>>;
}

function rejectUnknown(
    source: Readonly<Record<string, unknown>>,
    allowed: readonly string[],
): void {
    const unknown = Object.keys(source).find(key => !allowed.includes(key));
    if (unknown) invalidParameter(`包含未知字段: ${unknown}`);
}

function responseRecord(value: unknown, root: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse(root);
    return value as Record<string, unknown>;
}

function responseText(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !value.trim()) invalidResponse(root);
    return value;
}

function responseNumericId(value: unknown, root: unknown): string {
    const id = responseText(value, root);
    if (!/^\d+$/u.test(id)) invalidResponse(root);
    return id;
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}

function invalidResponse(value: unknown): never {
    throw new WhatsAppApiError("WhatsApp WABA Phone Number API 返回结构无效", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details: value,
    });
}
