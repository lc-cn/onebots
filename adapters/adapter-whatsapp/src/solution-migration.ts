import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";

export const WHATSAPP_MIGRATION_INTENT_FIELDS = Object.freeze(["id", "status"] as const);
export type WhatsAppMigrationIntentField = (typeof WHATSAPP_MIGRATION_INTENT_FIELDS)[number];

export const WHATSAPP_MIGRATION_STATUSES = Object.freeze([
    "ACCEPTED",
    "COMPLETED",
    "INITIATED",
    "REJECTED",
] as const);
export type WhatsAppMigrationStatus = (typeof WHATSAPP_MIGRATION_STATUSES)[number];

export const WHATSAPP_SOLUTION_MIGRATION_INTENTS = Object.freeze([
    "INITIATE_MIGRATION",
    "CANCEL_MIGRATION",
    "CONFIRM_MIGRATION",
    "SCHEDULE_MIGRATION",
] as const);
export type WhatsAppSolutionMigrationIntent = (typeof WHATSAPP_SOLUTION_MIGRATION_INTENTS)[number];

export const WHATSAPP_SOLUTION_MIGRATION_REQUEST_STATUSES = Object.freeze([
    "PENDING",
    "APPROVED",
    "REJECTED",
    "SCHEDULED",
] as const);
export type WhatsAppSolutionMigrationRequestStatus =
    (typeof WHATSAPP_SOLUTION_MIGRATION_REQUEST_STATUSES)[number];

export interface WhatsAppMigrationIntent {
    id: string;
    status: WhatsAppMigrationStatus;
}

export interface WhatsAppSolutionMigrationRequest {
    solution_id: string;
    migration_intent: WhatsAppSolutionMigrationIntent;
    target_solution_id?: string;
    migration_reason?: string;
    scheduled_migration_time?: string;
}

export interface WhatsAppSolutionMigrationResponse {
    success: true;
    migration_intent_id: string;
    status?: WhatsAppSolutionMigrationRequestStatus;
    estimated_completion_time?: string;
}

/** WABA Multi-Partner Solution 迁移意图的强类型控制面。 */
export class WhatsAppSolutionMigration {
    constructor(private readonly client: WhatsAppClient) {}

    async get(
        migrationIntentId: string,
        fields: readonly WhatsAppMigrationIntentField[] = WHATSAPP_MIGRATION_INTENT_FIELDS,
    ): Promise<WhatsAppMigrationIntent> {
        const response = await this.client.call<unknown>({
            resource: numericId(migrationIntentId, "migration_intent_id"),
            query: { fields: migrationFields(fields).join(",") },
        });
        return migrationIntentResponse(response);
    }

    async set(
        request: WhatsAppSolutionMigrationRequest,
    ): Promise<WhatsAppSolutionMigrationResponse> {
        const response = await this.client.call<unknown>({
            method: "POST",
            resource: `${this.client.config.business_account_id}/set_solution_migration_intent`,
            body: migrationRequest(request),
        });
        return solutionMigrationResponse(response);
    }
}

type SolutionMigrationActionParams = Readonly<Record<string, unknown>>;

const SOLUTION_MIGRATION_ACTION_HANDLERS = {
    get_migration_intent: (client: WhatsAppClient, params: SolutionMigrationActionParams) =>
        client.solutionMigration.get(
            requireString(params.migration_intent_id, "migration_intent_id"),
            actionFields(params),
        ),
    set_solution_migration_intent: (
        client: WhatsAppClient,
        params: SolutionMigrationActionParams,
    ) => client.solutionMigration.set(actionRequest(params)),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Solution Migration 动作的执行与参数契约单一来源。 */
export const WHATSAPP_SOLUTION_MIGRATION_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    SOLUTION_MIGRATION_ACTION_HANDLERS,
    {
        get_migration_intent: ["migration_intent_id", "fields"],
        set_solution_migration_intent: ["request"],
    },
);

export type WhatsAppSolutionMigrationAction =
    keyof typeof WHATSAPP_SOLUTION_MIGRATION_ACTION_HANDLERS;

export function isWhatsAppSolutionMigrationAction(
    action: string,
): action is WhatsAppSolutionMigrationAction {
    return Object.hasOwn(WHATSAPP_SOLUTION_MIGRATION_ACTION_HANDLERS, action);
}

function migrationIntentResponse(value: unknown): WhatsAppMigrationIntent {
    if (!isRecord(value)) invalidResponse(value);
    const id = requireResponseString(value.id, value);
    if (!isMigrationStatus(value.status)) invalidResponse(value);
    return { id, status: value.status };
}

function solutionMigrationResponse(value: unknown): WhatsAppSolutionMigrationResponse {
    if (!isRecord(value) || value.success !== true) invalidResponse(value);
    const migrationIntentId = requireResponseString(value.migration_intent_id, value);
    if (value.status !== undefined && !isMigrationRequestStatus(value.status)) {
        invalidResponse(value);
    }
    const estimated = optionalResponseTimestamp(value, "estimated_completion_time");
    return {
        success: true,
        migration_intent_id: migrationIntentId,
        ...(value.status === undefined ? {} : { status: value.status }),
        ...estimated,
    };
}

function migrationRequest(value: unknown): WhatsAppSolutionMigrationRequest {
    if (!isRecord(value)) invalidParameter("request 必须是对象");
    rejectUnknown(value, [
        "solution_id",
        "migration_intent",
        "target_solution_id",
        "migration_reason",
        "scheduled_migration_time",
    ]);
    const intent = solutionMigrationIntent(value.migration_intent);
    return {
        solution_id: numericId(value.solution_id, "solution_id"),
        migration_intent: intent,
        ...optionalNumericId(value, "target_solution_id"),
        ...optionalText(value, "migration_reason", 500),
        ...optionalTimestamp(value, "scheduled_migration_time"),
    };
}

function actionRequest(
    params: Readonly<Record<string, unknown>>,
): WhatsAppSolutionMigrationRequest {
    if (!isRecord(params.request)) invalidParameter("request 必须是对象");
    return migrationRequest(params.request);
}

function actionFields(
    params: Readonly<Record<string, unknown>>,
): readonly WhatsAppMigrationIntentField[] {
    if (params.fields === undefined) return WHATSAPP_MIGRATION_INTENT_FIELDS;
    if (!Array.isArray(params.fields)) invalidParameter("fields 必须是可增减的字段数组");
    return params.fields.map(field => {
        if (typeof field !== "string" || !isMigrationField(field)) {
            invalidParameter(`未知 Migration Intent 字段: ${String(field)}`);
        }
        return field;
    });
}

function migrationFields(
    fields: readonly WhatsAppMigrationIntentField[],
): WhatsAppMigrationIntentField[] {
    if (!fields.length) invalidParameter("Migration Intent fields 不能为空");
    const unique = [...new Set(fields)];
    if (unique.some(field => !isMigrationField(field)))
        invalidParameter("Migration Intent fields 无效");
    return unique;
}

function isMigrationField(value: string): value is WhatsAppMigrationIntentField {
    return (WHATSAPP_MIGRATION_INTENT_FIELDS as readonly string[]).includes(value);
}

function solutionMigrationIntent(value: unknown): WhatsAppSolutionMigrationIntent {
    if (!isSolutionMigrationIntent(value)) {
        invalidParameter(`未知 migration_intent: ${String(value)}`);
    }
    return value;
}

function isSolutionMigrationIntent(value: unknown): value is WhatsAppSolutionMigrationIntent {
    return (
        typeof value === "string" &&
        (WHATSAPP_SOLUTION_MIGRATION_INTENTS as readonly string[]).includes(value)
    );
}

function isMigrationStatus(value: unknown): value is WhatsAppMigrationStatus {
    return (
        typeof value === "string" &&
        (WHATSAPP_MIGRATION_STATUSES as readonly string[]).includes(value)
    );
}

function isMigrationRequestStatus(value: unknown): value is WhatsAppSolutionMigrationRequestStatus {
    return (
        typeof value === "string" &&
        (WHATSAPP_SOLUTION_MIGRATION_REQUEST_STATUSES as readonly string[]).includes(value)
    );
}

function optionalNumericId(source: Record<string, unknown>, name: string): Record<string, string> {
    const value = source[name];
    return value === undefined ? {} : { [name]: numericId(value, name) };
}

function numericId(value: unknown, name: string): string {
    if (typeof value !== "string" || !/^\d+$/u.test(value)) {
        invalidParameter(`${name} 必须是纯数字 ID`);
    }
    return value;
}

function optionalText(
    source: Record<string, unknown>,
    name: string,
    max: number,
): Record<string, string> {
    const value = source[name];
    if (value === undefined) return {};
    if (typeof value !== "string" || value.length > max) {
        invalidParameter(`${name} 必须是最长 ${max} 字符的字符串`);
    }
    return { [name]: value };
}

function optionalTimestamp(source: Record<string, unknown>, name: string): Record<string, string> {
    const value = source[name];
    if (value === undefined) return {};
    if (typeof value !== "string" || !isIsoTimestamp(value)) {
        invalidParameter(`${name} 必须是有效 ISO 8601 时间`);
    }
    return { [name]: value };
}

function optionalResponseTimestamp(
    source: Record<string, unknown>,
    name: string,
): Record<string, string> {
    const value = source[name];
    if (value === undefined) return {};
    if (typeof value !== "string" || !isIsoTimestamp(value)) invalidResponse(source);
    return { [name]: value };
}

function isIsoTimestamp(value: string): boolean {
    return (
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
        !Number.isNaN(Date.parse(value))
    );
}

function requireString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 不能为空`);
    return value;
}

function requireResponseString(value: unknown, details: unknown): string {
    if (typeof value !== "string" || !value) invalidResponse(details);
    return value;
}

function rejectUnknown(source: Record<string, unknown>, allowed: readonly string[]): void {
    const allowedSet = new Set(allowed);
    const unknown = Object.keys(source).find(key => !allowedSet.has(key));
    if (unknown) invalidParameter(`Solution Migration 请求包含未知字段: ${unknown}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp Solution Migration 响应不符合官方结构", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
