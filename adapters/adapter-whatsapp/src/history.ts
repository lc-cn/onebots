import type { PlatformActionHandler } from "onebots";
import { WhatsAppApiError } from "./errors.js";
import {
    isHistoryDeliveryStatus,
    parseHistoryEventsResponse,
    parseMessageHistoryResponse,
} from "./history-responses.js";
import type {
    WhatsAppHistoryDeliveryStatus,
    WhatsAppHistoryEventsQuery,
    WhatsAppHistoryEventsResponse,
    WhatsAppHistoryEventEdge,
    WhatsAppMessageHistoryEntry,
    WhatsAppMessageHistoryQuery,
    WhatsAppMessageHistoryResponse,
} from "./history-types.js";
import type { WhatsAppClient } from "./client.js";

const HISTORY_FIELDS =
    "id,message_id,events{delivery_status,webhook_update_state,timestamp,application,webhook_uri,error_description}";
const HISTORY_EVENT_FIELDS =
    "cursor,node{id,delivery_status,error_description,occurrence_timestamp,status_timestamp,application}";

export const WHATSAPP_HISTORY_ACTIONS = Object.freeze([
    "list_message_history",
    "list_message_history_events",
] as const);

export type WhatsAppHistoryAction = (typeof WHATSAPP_HISTORY_ACTIONS)[number];

export function isWhatsAppHistoryAction(action: string): action is WhatsAppHistoryAction {
    return (WHATSAPP_HISTORY_ACTIONS as readonly string[]).includes(action);
}

/** WhatsApp 消息投递历史深模块；负责查询约束、分页完整性与响应校验。 */
export class WhatsAppHistory {
    constructor(private readonly client: WhatsAppClient) {}

    async list(params: WhatsAppMessageHistoryQuery = {}): Promise<WhatsAppMessageHistoryResponse> {
        return parseMessageHistoryResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.phone_number_id}/message_history`,
                query: historyQuery(params),
            }),
        );
    }

    async listAll(
        params: Omit<WhatsAppMessageHistoryQuery, "after" | "before"> = {},
    ): Promise<WhatsAppMessageHistoryEntry[]> {
        return collectPages(after => this.list({ ...params, ...(after ? { after } : {}) }));
    }

    async listEvents(
        historyId: string,
        params: WhatsAppHistoryEventsQuery = {},
    ): Promise<WhatsAppHistoryEventsResponse> {
        return parseHistoryEventsResponse(
            await this.client.call<unknown>({
                resource: `${resourceId(historyId, "history_id")}/events`,
                query: eventQuery(params),
            }),
        );
    }

    async listAllEvents(
        historyId: string,
        params: Omit<WhatsAppHistoryEventsQuery, "after" | "before"> = {},
    ): Promise<WhatsAppHistoryEventEdge[]> {
        return collectPages(after =>
            this.listEvents(historyId, { ...params, ...(after ? { after } : {}) }),
        );
    }

    execute(
        action: WhatsAppHistoryAction,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        switch (action) {
            case "list_message_history":
                return this.list(queryParams(params));
            case "list_message_history_events":
                return this.listEvents(resourceParam(params, "history_id"), eventParams(params));
        }
    }
}

export const WHATSAPP_HISTORY_ACTION_HANDLERS = Object.fromEntries(
    WHATSAPP_HISTORY_ACTIONS.map(action => [
        action,
        (client: WhatsAppClient, params: Readonly<Record<string, unknown>>) =>
            client.history.execute(action, params),
    ]),
) as Record<WhatsAppHistoryAction, PlatformActionHandler<WhatsAppClient>>;

async function collectPages<T>(
    fetchPage: (
        after?: string,
    ) => Promise<{ data: T[]; paging?: { cursors?: { after?: string } } }>,
): Promise<T[]> {
    const data: T[] = [];
    const seen = new Set<string>();
    let after: string | undefined;
    do {
        const page = await fetchPage(after);
        data.push(...page.data);
        const next = page.paging?.cursors?.after;
        if (next && seen.has(next)) {
            throw new WhatsAppApiError("WhatsApp 消息历史分页 cursor 重复，无法确认结果完整", {
                code: "WHATSAPP_INVALID_RESPONSE",
            });
        }
        after = next;
        if (after) seen.add(after);
    } while (after);
    return data;
}

function historyQuery(
    params: WhatsAppMessageHistoryQuery,
): Record<string, string | number | undefined> {
    cursorPair(params);
    return {
        message_id: optionalTextValue(params.message_id, "message_id"),
        fields: HISTORY_FIELDS,
        limit: limitValue(params.limit),
        after: optionalTextValue(params.after, "after"),
        before: optionalTextValue(params.before, "before"),
    };
}

function eventQuery(
    params: WhatsAppHistoryEventsQuery,
): Record<string, string | number | undefined> {
    cursorPair(params);
    if (params.status_filter && !isHistoryDeliveryStatus(params.status_filter)) {
        invalidParameter("status_filter 不是有效投递状态");
    }
    return {
        status_filter: params.status_filter,
        fields: HISTORY_EVENT_FIELDS,
        limit: limitValue(params.limit),
        after: optionalTextValue(params.after, "after"),
        before: optionalTextValue(params.before, "before"),
    };
}

function queryParams(params: Readonly<Record<string, unknown>>): WhatsAppMessageHistoryQuery {
    return {
        message_id: optionalText(params, "message_id"),
        limit: optionalNumber(params, "limit"),
        after: optionalText(params, "after"),
        before: optionalText(params, "before"),
    };
}

function eventParams(params: Readonly<Record<string, unknown>>): WhatsAppHistoryEventsQuery {
    const status = optionalText(params, "status_filter");
    let statusFilter: WhatsAppHistoryDeliveryStatus | undefined;
    if (status) {
        if (!isHistoryDeliveryStatus(status)) invalidParameter("status_filter 无效");
        statusFilter = status;
    }
    return {
        ...(statusFilter ? { status_filter: statusFilter } : {}),
        limit: optionalNumber(params, "limit"),
        after: optionalText(params, "after"),
        before: optionalText(params, "before"),
    };
}

function cursorPair(params: { after?: string; before?: string }): void {
    if (params.after !== undefined && params.before !== undefined) {
        invalidParameter("after 与 before 不能同时使用");
    }
}

function limitValue(value: number | undefined): number | undefined {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 100)) {
        invalidParameter("limit 必须是 1-100 的整数");
    }
    return value;
}

function optionalTextValue(value: string | undefined, name: string): string | undefined {
    if (value !== undefined && !value.trim()) invalidParameter(`${name} 不能为空`);
    return value;
}

function optionalText(params: Readonly<Record<string, unknown>>, name: string): string | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function optionalNumber(
    params: Readonly<Record<string, unknown>>,
    name: string,
): number | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (typeof value !== "number") invalidParameter(`${name} 必须是数字`);
    return value;
}

function resourceParam(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = optionalText(params, name);
    if (!value) invalidParameter(`${name} 不能为空`);
    return resourceId(value, name);
}

function resourceId(value: string, name: string): string {
    if (!/^[A-Za-z\d._:-]+$/u.test(value)) invalidParameter(`${name} 必须是单段 Graph 资源 ID`);
    return value;
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
