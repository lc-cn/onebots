import { WhatsAppApiError } from "./errors.js";
import type {
    WhatsAppHistoryDeliveryStatus,
    WhatsAppHistoryEvent,
    WhatsAppHistoryEventEdge,
    WhatsAppHistoryEventOccurrence,
    WhatsAppHistoryEventsResponse,
    WhatsAppHistoryPaging,
    WhatsAppMessageHistoryEntry,
    WhatsAppMessageHistoryResponse,
    WhatsAppWebhookUpdateState,
} from "./history-types.js";

const DELIVERY_STATUSES = new Set<WhatsAppHistoryDeliveryStatus>([
    "SENT",
    "DELIVERED",
    "READ",
    "FAILED",
    "DELETED",
]);
const WEBHOOK_STATES = new Set<WhatsAppWebhookUpdateState>([
    "PENDING",
    "DELIVERED",
    "FAILED",
    "RETRYING",
]);

export function parseMessageHistoryResponse(value: unknown): WhatsAppMessageHistoryResponse {
    const response = record(value);
    if (!response || !Array.isArray(response.data)) invalidResponse("消息历史响应缺少 data");
    return {
        data: response.data.map(parseHistoryEntry),
        ...(response.paging !== undefined ? { paging: parsePaging(response.paging) } : {}),
    };
}

export function parseHistoryEventsResponse(value: unknown): WhatsAppHistoryEventsResponse {
    const response = record(value);
    if (!response || !Array.isArray(response.data)) {
        invalidResponse("消息历史事件响应缺少 data");
    }
    return {
        data: response.data.map(parseEventEdge),
        ...(response.paging !== undefined ? { paging: parsePaging(response.paging) } : {}),
    };
}

export function isHistoryDeliveryStatus(value: string): value is WhatsAppHistoryDeliveryStatus {
    return DELIVERY_STATUSES.has(value as WhatsAppHistoryDeliveryStatus);
}

function parseHistoryEntry(value: unknown): WhatsAppMessageHistoryEntry {
    const entry = record(value);
    if (!entry || !text(entry.id) || !text(entry.message_id)) {
        invalidResponse("消息历史条目缺少 id 或 message_id");
    }
    const events = record(entry.events);
    if (entry.events !== undefined && (!events || !Array.isArray(events.data))) {
        invalidResponse("消息历史条目的 events 缺少 data");
    }
    return {
        id: entry.id,
        message_id: entry.message_id,
        ...(events
            ? {
                  events: {
                      data: (events.data as unknown[]).map(parseHistoryEvent),
                      ...(events.paging !== undefined
                          ? { paging: parsePaging(events.paging) }
                          : {}),
                  },
              }
            : {}),
    };
}

function parseHistoryEvent(value: unknown): WhatsAppHistoryEvent {
    const event = record(value);
    if (
        !event ||
        !text(event.id) ||
        !deliveryStatus(event.delivery_status) ||
        !integer(event.timestamp)
    ) {
        invalidResponse("消息历史状态事件缺少必填字段");
    }
    const webhookState = event.webhook_update_state;
    if (
        webhookState !== undefined &&
        (typeof webhookState !== "string" ||
            !WEBHOOK_STATES.has(webhookState as WhatsAppWebhookUpdateState))
    ) {
        invalidResponse("消息历史状态事件包含无效 webhook_update_state");
    }
    return {
        id: event.id,
        delivery_status: event.delivery_status,
        timestamp: event.timestamp,
        ...(webhookState
            ? { webhook_update_state: webhookState as WhatsAppWebhookUpdateState }
            : {}),
        ...optionalApplication(event.application),
        ...optionalText(event, "webhook_uri"),
        ...optionalText(event, "error_description"),
    };
}

function parseEventEdge(value: unknown): WhatsAppHistoryEventEdge {
    const edge = record(value);
    if (!edge || edge.node === undefined) invalidResponse("消息历史事件 edge 缺少 node");
    return {
        ...optionalText(edge, "cursor"),
        node: parseEventOccurrence(edge.node),
    };
}

function parseEventOccurrence(value: unknown): WhatsAppHistoryEventOccurrence {
    const event = record(value);
    if (
        !event ||
        !text(event.id) ||
        !deliveryStatus(event.delivery_status) ||
        !integer(event.occurrence_timestamp) ||
        (event.status_timestamp !== undefined && !integer(event.status_timestamp))
    ) {
        invalidResponse("消息历史事件明细缺少必填字段");
    }
    const application = record(event.application);
    if (event.application !== undefined && !application) {
        invalidResponse("消息历史事件明细的 application 必须是对象");
    }
    return {
        id: event.id,
        delivery_status: event.delivery_status,
        occurrence_timestamp: event.occurrence_timestamp,
        ...(integer(event.status_timestamp) ? { status_timestamp: event.status_timestamp } : {}),
        ...optionalText(event, "error_description"),
        ...(application
            ? {
                  application: {
                      ...(text(application.id) ? { id: application.id } : {}),
                      ...(text(application.name) ? { name: application.name } : {}),
                  },
              }
            : {}),
    };
}

function parsePaging(value: unknown): WhatsAppHistoryPaging {
    const paging = record(value);
    if (!paging) invalidResponse("消息历史 paging 必须是对象");
    const cursors = record(paging.cursors);
    if (paging.cursors !== undefined && !cursors) invalidResponse("paging.cursors 必须是对象");
    return {
        ...(cursors
            ? {
                  cursors: {
                      ...optionalText(cursors, "before"),
                      ...optionalText(cursors, "after"),
                  },
              }
            : {}),
        ...optionalText(paging, "previous"),
        ...optionalText(paging, "next"),
    };
}

function optionalApplication(value: unknown): { application?: { id?: string } } {
    if (value === undefined) return {};
    const application = record(value);
    if (!application) invalidResponse("消息历史状态事件的 application 必须是对象");
    return { application: text(application.id) ? { id: application.id } : {} };
}

function optionalText<TName extends string>(
    value: Record<string, unknown>,
    name: TName,
): Partial<Record<TName, string>> {
    const item = value[name];
    if (item === undefined) return {};
    if (!text(item)) invalidResponse(`${name} 必须是非空字符串`);
    return { [name]: item } as Partial<Record<TName, string>>;
}

function deliveryStatus(value: unknown): value is WhatsAppHistoryDeliveryStatus {
    return typeof value === "string" && isHistoryDeliveryStatus(value);
}

function text(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function integer(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function invalidResponse(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_RESPONSE" });
}
