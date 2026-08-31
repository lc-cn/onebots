import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import { parseWhatsAppPaging } from "./graph-paging.js";
import {
    scheduleClock,
    scheduleDays,
    scheduleRecurrence,
    scheduleTimestamp,
    scheduleTimeZone,
} from "./schedule-validation.js";
import {
    WHATSAPP_SCHEDULE_FIELDS,
    WHATSAPP_SCHEDULE_SORTS,
    WHATSAPP_SCHEDULE_STATUSES,
    WHATSAPP_SCHEDULE_TYPES,
    type WhatsAppSchedule,
    type WhatsAppScheduleCreateRequest,
    type WhatsAppScheduleCreateResponse,
    type WhatsAppScheduleField,
    type WhatsAppScheduleFilter,
    type WhatsAppSchedulesQuery,
    type WhatsAppSchedulesResponse,
} from "./schedule-types.js";

/** WABA 业务时段、自动响应、Campaign 与维护窗口 Schedule 控制面。 */
export class WhatsAppSchedules {
    constructor(private readonly client: WhatsAppClient) {}

    async list(query: WhatsAppSchedulesQuery = {}): Promise<WhatsAppSchedulesResponse> {
        const normalized = listQuery(query);
        return listResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.business_account_id}/schedules`,
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

    async create(request: WhatsAppScheduleCreateRequest): Promise<WhatsAppScheduleCreateResponse> {
        return createResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.business_account_id}/schedules`,
                body: createRequest(request),
            }),
        );
    }
}

type ScheduleActionParams = Readonly<Record<string, unknown>>;

const SCHEDULE_ACTION_HANDLERS = {
    list_business_schedules: (client: WhatsAppClient, params: ScheduleActionParams) =>
        client.schedules.list(params.query === undefined ? {} : queryInput(params.query)),
    create_business_schedule: (client: WhatsAppClient, params: ScheduleActionParams) =>
        client.schedules.create(createRequest(params.request)),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Business Schedule 动作的执行与参数契约单一来源。 */
export const WHATSAPP_SCHEDULE_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    SCHEDULE_ACTION_HANDLERS,
    {
        list_business_schedules: ["query"],
        create_business_schedule: ["request"],
    },
);

export type WhatsAppScheduleAction = keyof typeof WHATSAPP_SCHEDULE_ACTION_HANDLERS;

export function isWhatsAppScheduleAction(action: string): action is WhatsAppScheduleAction {
    return Object.hasOwn(WHATSAPP_SCHEDULE_ACTION_HANDLERS, action);
}

function queryInput(value: unknown): WhatsAppSchedulesQuery {
    const source = inputRecord(value, "query");
    rejectUnknown(source, ["fields", "filters", "sort", "limit", "after", "before"]);
    return {
        ...(source.fields === undefined ? {} : { fields: selectedFields(source.fields) }),
        ...(source.filters === undefined ? {} : { filters: selectedFilters(source.filters) }),
        ...(source.sort === undefined ? {} : { sort: inputSort(source.sort) }),
        ...(source.limit === undefined ? {} : { limit: inputNumber(source.limit, "limit") }),
        ...(source.after === undefined ? {} : { after: inputText(source.after, "after") }),
        ...(source.before === undefined ? {} : { before: inputText(source.before, "before") }),
    };
}

function listQuery(query: WhatsAppSchedulesQuery): {
    fields: WhatsAppScheduleField[];
    filters?: WhatsAppScheduleFilter[];
    sort?: WhatsAppSchedulesQuery["sort"];
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
        fields: selectedFields(query.fields || WHATSAPP_SCHEDULE_FIELDS),
        filters: query.filters ? selectedFilters(query.filters) : undefined,
        sort: query.sort === undefined ? undefined : inputSort(query.sort),
        limit: query.limit,
        after: optionalText(query.after, "after"),
        before: optionalText(query.before, "before"),
    };
}

function createRequest(value: unknown): WhatsAppScheduleCreateRequest {
    const source = inputRecord(value, "request");
    rejectUnknown(source, [
        "name",
        "schedule_type",
        "description",
        "start_time",
        "end_time",
        "timezone",
        "days_of_week",
        "is_active",
        "recurrence_pattern",
    ]);
    const startTime = scheduleClock(source.start_time, "start_time", invalidParameter);
    const endTime = scheduleClock(source.end_time, "end_time", invalidParameter);
    if (startTime === endTime) invalidParameter("start_time 与 end_time 不能相同");
    return {
        name: boundedText(source.name, "name", 1, 100),
        schedule_type: inputEnum(source.schedule_type, WHATSAPP_SCHEDULE_TYPES, "schedule_type"),
        start_time: startTime,
        end_time: endTime,
        timezone:
            source.timezone === undefined
                ? "UTC"
                : scheduleTimeZone(source.timezone, "timezone", invalidParameter),
        is_active:
            source.is_active === undefined ? true : inputBoolean(source.is_active, "is_active"),
        ...(source.description === undefined
            ? {}
            : { description: boundedText(source.description, "description", 1, 500) }),
        ...(source.days_of_week === undefined
            ? {}
            : { days_of_week: scheduleDays(source.days_of_week, invalidParameter) }),
        ...(source.recurrence_pattern === undefined
            ? {}
            : {
                  recurrence_pattern: scheduleRecurrence(
                      source.recurrence_pattern,
                      invalidParameter,
                  ),
              }),
    };
}

function selectedFields(value: unknown): WhatsAppScheduleField[] {
    if (!Array.isArray(value) || !value.length) invalidParameter("fields 必须是非空数组");
    const fields = value.map(field => {
        if (
            typeof field !== "string" ||
            !(WHATSAPP_SCHEDULE_FIELDS as readonly string[]).includes(field)
        ) {
            invalidParameter(`不支持 Schedule 字段: ${String(field)}`);
        }
        return field as WhatsAppScheduleField;
    });
    return [
        ...new Set([
            "id" as const,
            "name" as const,
            "status" as const,
            "schedule_type" as const,
            ...fields,
        ]),
    ];
}

function selectedFilters(value: unknown): WhatsAppScheduleFilter[] {
    if (!Array.isArray(value) || !value.length || value.length > 3) {
        invalidParameter("filters 必须是包含 1 到 3 项的数组");
    }
    const filters = value.map((item, index) => filterInput(item, index));
    if (new Set(filters.map(filter => filter.field)).size !== filters.length) {
        invalidParameter("filters 中的 field 不能重复");
    }
    return filters;
}

function filterInput(value: unknown, index: number): WhatsAppScheduleFilter {
    const source = inputRecord(value, `filters[${index}]`);
    rejectUnknown(source, ["field", "operator", "value"]);
    if (source.operator !== "EQUAL") invalidParameter(`filters[${index}].operator 仅支持 EQUAL`);
    if (source.field === "status") {
        return {
            field: "status",
            operator: "EQUAL",
            value: inputEnum(source.value, WHATSAPP_SCHEDULE_STATUSES, `filters[${index}].value`),
        };
    }
    if (source.field === "schedule_type") {
        return {
            field: "schedule_type",
            operator: "EQUAL",
            value: inputEnum(source.value, WHATSAPP_SCHEDULE_TYPES, `filters[${index}].value`),
        };
    }
    if (source.field === "is_active") {
        return {
            field: "is_active",
            operator: "EQUAL",
            value: inputBoolean(source.value, `filters[${index}].value`),
        };
    }
    return invalidParameter(`不支持 filters[${index}].field: ${String(source.field)}`);
}

function inputSort(value: unknown): WhatsAppSchedulesQuery["sort"] {
    return inputEnum(value, WHATSAPP_SCHEDULE_SORTS, "sort");
}

function listResponse(
    value: unknown,
    fields: readonly WhatsAppScheduleField[],
): WhatsAppSchedulesResponse {
    const source = responseRecord(value, value);
    if (!Array.isArray(source.data)) invalidResponse(value);
    return {
        data: source.data.map(item => scheduleResponse(item, fields, value)),
        ...(source.paging === undefined
            ? {}
            : { paging: parseWhatsAppPaging(source.paging, value, invalidResponse) }),
    };
}

function scheduleResponse(
    value: unknown,
    fields: readonly WhatsAppScheduleField[],
    root: unknown,
): WhatsAppSchedule {
    const source = responseRecord(value, root);
    const result: WhatsAppSchedule = {
        id: responseNumericId(source.id, root),
        name: responseText(source.name, root),
        status: responseEnum(source.status, WHATSAPP_SCHEDULE_STATUSES, root),
        schedule_type: responseEnum(source.schedule_type, WHATSAPP_SCHEDULE_TYPES, root),
    };
    assignText(result, source, fields, "description", root);
    assignClock(result, source, fields, "start_time", root);
    assignClock(result, source, fields, "end_time", root);
    assignTimeZone(result, source, fields, root);
    if (fields.includes("days_of_week") && source.days_of_week !== undefined) {
        result.days_of_week = scheduleDays(source.days_of_week, () => invalidResponse(root));
    }
    assignTimestamp(result, source, fields, "created_time", root);
    assignTimestamp(result, source, fields, "updated_time", root);
    if (fields.includes("is_active") && source.is_active !== undefined) {
        if (typeof source.is_active !== "boolean") invalidResponse(root);
        result.is_active = source.is_active;
    }
    if (fields.includes("recurrence_pattern") && source.recurrence_pattern !== undefined) {
        result.recurrence_pattern = scheduleRecurrence(source.recurrence_pattern, () =>
            invalidResponse(root),
        );
    }
    return result;
}

function assignText(
    target: WhatsAppSchedule,
    source: Readonly<Record<string, unknown>>,
    fields: readonly WhatsAppScheduleField[],
    field: "description",
    root: unknown,
): void {
    if (fields.includes(field) && source[field] !== undefined)
        target[field] = responseText(source[field], root);
}

function assignClock(
    target: WhatsAppSchedule,
    source: Readonly<Record<string, unknown>>,
    fields: readonly WhatsAppScheduleField[],
    field: "start_time" | "end_time",
    root: unknown,
): void {
    if (fields.includes(field) && source[field] !== undefined)
        target[field] = scheduleClock(source[field], field, () => invalidResponse(root));
}

function assignTimestamp(
    target: WhatsAppSchedule,
    source: Readonly<Record<string, unknown>>,
    fields: readonly WhatsAppScheduleField[],
    field: "created_time" | "updated_time",
    root: unknown,
): void {
    if (fields.includes(field) && source[field] !== undefined)
        target[field] = scheduleTimestamp(source[field], field, () => invalidResponse(root));
}

function assignTimeZone(
    target: WhatsAppSchedule,
    source: Readonly<Record<string, unknown>>,
    fields: readonly WhatsAppScheduleField[],
    root: unknown,
): void {
    if (fields.includes("timezone") && source.timezone !== undefined) {
        target.timezone = scheduleTimeZone(source.timezone, "timezone", () =>
            invalidResponse(root),
        );
    }
}

function createResponse(value: unknown): WhatsAppScheduleCreateResponse {
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

function optionalText(value: unknown, name: string): string | undefined {
    return value === undefined ? undefined : inputText(value, name);
}

function inputBoolean(value: unknown, name: string): boolean {
    if (typeof value !== "boolean") invalidParameter(`${name} 必须是布尔值`);
    return value;
}

function inputNumber(value: unknown, name: string): number {
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

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}

function invalidResponse(value: unknown): never {
    throw new WhatsAppApiError("WhatsApp WABA Schedule API 返回结构无效", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details: value,
    });
}
