import type { PlatformActionHandler } from "onebots";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import {
    WHATSAPP_BUSINESS_ACCOUNT_ACTIONS,
    WHATSAPP_BUSINESS_ACCOUNT_ACTIVITY_FIELDS,
    WHATSAPP_BUSINESS_ACCOUNT_ACTIVITY_TYPES,
    WHATSAPP_BUSINESS_ACCOUNT_ACTOR_TYPES,
    WHATSAPP_BUSINESS_ACCOUNT_FIELDS,
    WHATSAPP_BUSINESS_ACCOUNT_OWNERSHIP_TYPES,
    WHATSAPP_BUSINESS_ACCOUNT_REVIEW_STATUSES,
    WHATSAPP_BUSINESS_VERIFICATION_STATUSES,
    type WhatsAppBusinessAccount,
    type WhatsAppBusinessAccountAction,
    type WhatsAppBusinessAccountActivitiesQuery,
    type WhatsAppBusinessAccountActivitiesResponse,
    type WhatsAppBusinessAccountActivity,
    type WhatsAppBusinessAccountActivityField,
    type WhatsAppBusinessAccountActivityType,
    type WhatsAppBusinessAccountField,
    type WhatsAppBusinessAccountUpdate,
    type WhatsAppBusinessAccountUpdateResponse,
    type WhatsAppJsonValue,
} from "./business-account-types.js";

export * from "./business-account-types.js";

export function isWhatsAppBusinessAccountAction(
    action: string,
): action is WhatsAppBusinessAccountAction {
    return (WHATSAPP_BUSINESS_ACCOUNT_ACTIONS as readonly string[]).includes(action);
}

/** WABA 身份、受控配置与活动审计；所有写字段和审计过滤器都在边界闭合。 */
export class WhatsAppBusinessAccounts {
    constructor(private readonly client: WhatsAppClient) {}

    async get(
        fields: readonly WhatsAppBusinessAccountField[] = WHATSAPP_BUSINESS_ACCOUNT_FIELDS,
    ): Promise<WhatsAppBusinessAccount> {
        const selection = accountFields(fields);
        return accountResponse(
            await this.client.call<unknown>({
                resource: this.client.config.business_account_id,
                query: { fields: selection.join(",") },
            }),
            selection,
        );
    }

    async update(
        update: WhatsAppBusinessAccountUpdate,
    ): Promise<WhatsAppBusinessAccountUpdateResponse> {
        return successResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: this.client.config.business_account_id,
                body: updateRequest(update),
            }),
        );
    }

    async listActivities(
        query: WhatsAppBusinessAccountActivitiesQuery = {},
    ): Promise<WhatsAppBusinessAccountActivitiesResponse> {
        const normalized = activitiesQuery(query);
        return activitiesResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.business_account_id}/activities`,
                query: {
                    fields: normalized.fields.join(","),
                    limit: normalized.limit,
                    after: normalized.after,
                    before: normalized.before,
                    since: normalized.since,
                    until: normalized.until,
                    activity_type: normalized.activityTypes?.join(","),
                },
            }),
            normalized.fields,
        );
    }

    execute(
        action: WhatsAppBusinessAccountAction,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        switch (action) {
            case "get_business_account":
                rejectUnknown(params, ["fields"]);
                return this.get(
                    params.fields === undefined
                        ? WHATSAPP_BUSINESS_ACCOUNT_FIELDS
                        : accountFields(params.fields),
                );
            case "update_business_account":
                rejectUnknown(params, ["account"]);
                return this.update(updateRequest(params.account));
            case "list_business_account_activities":
                rejectUnknown(params, ["query"]);
                return this.listActivities(
                    params.query === undefined ? {} : activityQueryInput(params.query),
                );
        }
    }
}

export const WHATSAPP_BUSINESS_ACCOUNT_ACTION_HANDLERS = Object.fromEntries(
    WHATSAPP_BUSINESS_ACCOUNT_ACTIONS.map(action => [
        action,
        (client: WhatsAppClient, params: Readonly<Record<string, unknown>>) =>
            client.businessAccount.execute(action, params),
    ]),
) as Record<WhatsAppBusinessAccountAction, PlatformActionHandler<WhatsAppClient>>;

function updateRequest(value: unknown): WhatsAppBusinessAccountUpdate {
    const source = inputRecord(value, "account");
    rejectUnknown(source, ["name", "timezone_id"]);
    const result: WhatsAppBusinessAccountUpdate = {};
    if (source.name !== undefined) result.name = boundedText(source.name, "name", 100);
    if (source.timezone_id !== undefined) {
        result.timezone_id = boundedText(source.timezone_id, "timezone_id", 64);
    }
    if (!Object.keys(result).length) invalidParameter("account 至少包含 name 或 timezone_id");
    return result;
}

function activityQueryInput(value: unknown): WhatsAppBusinessAccountActivitiesQuery {
    const source = inputRecord(value, "query");
    rejectUnknown(source, [
        "fields",
        "limit",
        "after",
        "before",
        "since",
        "until",
        "activity_types",
    ]);
    return {
        ...(source.fields === undefined ? {} : { fields: activityFields(source.fields) }),
        ...(source.limit === undefined ? {} : { limit: inputLimit(source.limit) }),
        ...(source.after === undefined ? {} : { after: inputText(source.after, "after") }),
        ...(source.before === undefined ? {} : { before: inputText(source.before, "before") }),
        ...(source.since === undefined ? {} : { since: inputText(source.since, "since") }),
        ...(source.until === undefined ? {} : { until: inputText(source.until, "until") }),
        ...(source.activity_types === undefined
            ? {}
            : { activity_types: activityTypes(source.activity_types) }),
    };
}

function activitiesQuery(query: WhatsAppBusinessAccountActivitiesQuery): {
    fields: WhatsAppBusinessAccountActivityField[];
    limit?: number;
    after?: string;
    before?: string;
    since?: string;
    until?: string;
    activityTypes?: WhatsAppBusinessAccountActivityType[];
} {
    rejectUnknown(inputRecord(query, "query"), [
        "fields",
        "limit",
        "after",
        "before",
        "since",
        "until",
        "activity_types",
    ]);
    const fields = activityFields(query.fields || WHATSAPP_BUSINESS_ACCOUNT_ACTIVITY_FIELDS);
    if (
        query.limit !== undefined &&
        (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)
    ) {
        invalidParameter("limit 必须是 1 到 100 的整数");
    }
    if (query.after && query.before) invalidParameter("after 与 before 不能同时使用");
    const since = query.since === undefined ? undefined : timeFilter(query.since, "since");
    const until = query.until === undefined ? undefined : timeFilter(query.until, "until");
    if (since && until && timeValue(until) < timeValue(since)) {
        invalidParameter("until 不能早于 since");
    }
    if (since && until && timeValue(until) - timeValue(since) > 90 * 86_400_000) {
        invalidParameter("活动审计时间范围不能超过 90 天");
    }
    return {
        fields,
        limit: query.limit,
        after: optionalInputText(query.after, "after"),
        before: optionalInputText(query.before, "before"),
        since,
        until,
        activityTypes: query.activity_types ? activityTypes(query.activity_types) : undefined,
    };
}

function accountFields(value: unknown): WhatsAppBusinessAccountField[] {
    return selectedFields(value, WHATSAPP_BUSINESS_ACCOUNT_FIELDS, ["id", "name"], "WABA");
}

function activityFields(value: unknown): WhatsAppBusinessAccountActivityField[] {
    return selectedFields(
        value,
        WHATSAPP_BUSINESS_ACCOUNT_ACTIVITY_FIELDS,
        ["id", "activity_type", "timestamp", "actor_type"],
        "activity",
    );
}

function selectedFields<T extends string>(
    value: unknown,
    allowed: readonly T[],
    required: readonly T[],
    label: string,
): T[] {
    if (!Array.isArray(value) || !value.length) invalidParameter("fields 必须是非空数组");
    const fields = value.map(field => {
        if (typeof field !== "string" || !allowed.includes(field as T)) {
            invalidParameter(`不支持 ${label} 字段: ${String(field)}`);
        }
        return field as T;
    });
    return [...new Set([...required, ...fields])];
}

function activityTypes(value: unknown): WhatsAppBusinessAccountActivityType[] {
    if (!Array.isArray(value) || !value.length) invalidParameter("activity_types 必须是非空数组");
    return [...new Set(value.map(activityType))];
}

function activityType(value: unknown): WhatsAppBusinessAccountActivityType {
    if (
        typeof value !== "string" ||
        !(WHATSAPP_BUSINESS_ACCOUNT_ACTIVITY_TYPES as readonly string[]).includes(value)
    ) {
        invalidParameter(`不支持 activity_type: ${String(value)}`);
    }
    return value as WhatsAppBusinessAccountActivityType;
}

function accountResponse(
    value: unknown,
    fields: readonly WhatsAppBusinessAccountField[],
): WhatsAppBusinessAccount {
    const source = responseRecord(value, value);
    const result: WhatsAppBusinessAccount = {
        id: responseNumericId(source.id, value),
        name: responseText(source.name, value),
    };
    const timezone = selectedText(source, "timezone_id", fields, value);
    if (timezone) result.timezone_id = timezone;
    const namespace = selectedText(source, "message_template_namespace", fields, value);
    if (namespace) result.message_template_namespace = namespace;
    const reviewStatus = selectedEnum(
        source,
        "account_review_status",
        fields,
        WHATSAPP_BUSINESS_ACCOUNT_REVIEW_STATUSES,
        value,
    );
    if (reviewStatus) result.account_review_status = reviewStatus;
    const verificationStatus = selectedEnum(
        source,
        "business_verification_status",
        fields,
        WHATSAPP_BUSINESS_VERIFICATION_STATUSES,
        value,
    );
    if (verificationStatus) result.business_verification_status = verificationStatus;
    const country = selectedText(source, "country", fields, value);
    if (country) result.country = country;
    const ownershipType = selectedEnum(
        source,
        "ownership_type",
        fields,
        WHATSAPP_BUSINESS_ACCOUNT_OWNERSHIP_TYPES,
        value,
    );
    if (ownershipType) result.ownership_type = ownershipType;
    const location = selectedText(source, "primary_business_location", fields, value);
    if (location) result.primary_business_location = location;
    return result;
}

function selectedText<T extends string>(
    source: Readonly<Record<string, unknown>>,
    field: T,
    fields: readonly T[],
    root: unknown,
): string | undefined {
    if (!fields.includes(field) || source[field] === undefined) return undefined;
    return responseText(source[field], root);
}

function selectedEnum<T extends string, F extends string>(
    source: Readonly<Record<string, unknown>>,
    field: F,
    fields: readonly F[],
    allowed: readonly T[],
    root: unknown,
): T | undefined {
    if (!fields.includes(field) || source[field] === undefined) return undefined;
    return responseEnum(source[field], allowed, root);
}

function activitiesResponse(
    value: unknown,
    fields: readonly WhatsAppBusinessAccountActivityField[],
): WhatsAppBusinessAccountActivitiesResponse {
    const source = responseRecord(value, value);
    if (!Array.isArray(source.data)) invalidResponse(value);
    return {
        data: source.data.map(item => activityResponse(item, fields, value)),
        ...(source.paging === undefined ? {} : { paging: pagingResponse(source.paging, value) }),
    };
}

function activityResponse(
    value: unknown,
    fields: readonly WhatsAppBusinessAccountActivityField[],
    root: unknown,
): WhatsAppBusinessAccountActivity {
    const source = responseRecord(value, root);
    const result: WhatsAppBusinessAccountActivity = {
        id: responseNumericId(source.id, root),
        activity_type: responseEnum(
            source.activity_type,
            WHATSAPP_BUSINESS_ACCOUNT_ACTIVITY_TYPES,
            root,
        ),
        timestamp: responseTimestamp(source.timestamp, root),
        actor_type: responseEnum(source.actor_type, WHATSAPP_BUSINESS_ACCOUNT_ACTOR_TYPES, root),
    };
    const actorId = selectedText(source, "actor_id", fields, root);
    if (actorId) result.actor_id = actorId;
    const actorName = selectedText(source, "actor_name", fields, root);
    if (actorName) result.actor_name = actorName;
    const description = selectedText(source, "description", fields, root);
    if (description) result.description = description;
    if (fields.includes("details") && source.details !== undefined) {
        if (!isJsonRecord(source.details)) invalidResponse(root);
        result.details = structuredClone(source.details);
    }
    const ipAddress = selectedText(source, "ip_address", fields, root);
    if (ipAddress) result.ip_address = ipAddress;
    const userAgent = selectedText(source, "user_agent", fields, root);
    if (userAgent) result.user_agent = userAgent;
    return result;
}

function pagingResponse(
    value: unknown,
    root: unknown,
): WhatsAppBusinessAccountActivitiesResponse["paging"] {
    const source = responseRecord(value, root);
    const cursors = source.cursors === undefined ? undefined : responseRecord(source.cursors, root);
    return {
        ...(cursors
            ? {
                  cursors: {
                      ...(cursors.before === undefined
                          ? {}
                          : { before: responseText(cursors.before, root) }),
                      ...(cursors.after === undefined
                          ? {}
                          : { after: responseText(cursors.after, root) }),
                  },
              }
            : {}),
        ...(source.previous === undefined
            ? {}
            : { previous: responseHttpsUrl(source.previous, root) }),
        ...(source.next === undefined ? {} : { next: responseHttpsUrl(source.next, root) }),
    };
}

function successResponse(value: unknown): WhatsAppBusinessAccountUpdateResponse {
    const source = responseRecord(value, value);
    if (source.success !== true) invalidResponse(value);
    return { success: true };
}

function timeFilter(value: unknown, name: string): string {
    const text = inputText(value, name);
    if (!/^\d+$/u.test(text) && !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(text)) {
        invalidParameter(`${name} 必须是 Unix 秒时间戳或 ISO 8601 时间`);
    }
    if (!Number.isFinite(timeValue(text))) invalidParameter(`${name} 不是有效时间`);
    return text;
}

function timeValue(value: string): number {
    return /^\d+$/u.test(value) ? Number(value) * 1000 : Date.parse(value);
}

function responseTimestamp(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalidResponse(root);
    return value;
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

function optionalInputText(value: unknown, name: string): string | undefined {
    return value === undefined ? undefined : inputText(value, name);
}

function inputLimit(value: unknown): number {
    if (typeof value !== "number") invalidParameter("limit 必须是数字");
    return value;
}

function inputText(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function boundedText(value: unknown, name: string, max: number): string {
    const text = inputText(value, name);
    if ([...text].length > max) invalidParameter(`${name} 不能超过 ${max} 个字符`);
    return text;
}

function inputRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        invalidParameter(`${name} 必须是对象`);
    }
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

function isJsonRecord(value: unknown): value is Record<string, WhatsAppJsonValue> {
    return (
        Boolean(value) && typeof value === "object" && !Array.isArray(value) && isJsonValue(value)
    );
}

function isJsonValue(value: unknown): value is WhatsAppJsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJsonValue);
    return Boolean(value) && typeof value === "object" && Object.values(value).every(isJsonValue);
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}

function invalidResponse(value: unknown): never {
    throw new WhatsAppApiError("WhatsApp WABA API 返回结构无效", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details: value,
    });
}
