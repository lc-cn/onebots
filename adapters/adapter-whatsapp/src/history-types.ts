export type WhatsAppHistoryDeliveryStatus = "SENT" | "DELIVERED" | "READ" | "FAILED" | "DELETED";

export type WhatsAppWebhookUpdateState = "PENDING" | "DELIVERED" | "FAILED" | "RETRYING";

export interface WhatsAppHistoryPaging {
    cursors?: { before?: string; after?: string };
    previous?: string;
    next?: string;
}

export interface WhatsAppHistoryEvent {
    id: string;
    delivery_status: WhatsAppHistoryDeliveryStatus;
    timestamp: number;
    webhook_update_state?: WhatsAppWebhookUpdateState;
    application?: { id?: string };
    webhook_uri?: string;
    error_description?: string;
}

export interface WhatsAppMessageHistoryEntry {
    id: string;
    message_id: string;
    events?: {
        data: WhatsAppHistoryEvent[];
        paging?: WhatsAppHistoryPaging;
    };
}

export interface WhatsAppMessageHistoryResponse {
    data: WhatsAppMessageHistoryEntry[];
    paging?: WhatsAppHistoryPaging;
}

export interface WhatsAppHistoryEventOccurrence {
    id: string;
    delivery_status: WhatsAppHistoryDeliveryStatus;
    occurrence_timestamp: number;
    status_timestamp?: number;
    error_description?: string;
    application?: { id?: string; name?: string };
}

export interface WhatsAppHistoryEventEdge {
    cursor?: string;
    node: WhatsAppHistoryEventOccurrence;
}

export interface WhatsAppHistoryEventsResponse {
    data: WhatsAppHistoryEventEdge[];
    paging?: WhatsAppHistoryPaging;
}

export interface WhatsAppMessageHistoryQuery {
    message_id?: string;
    limit?: number;
    after?: string;
    before?: string;
}

export interface WhatsAppHistoryEventsQuery {
    status_filter?: WhatsAppHistoryDeliveryStatus;
    limit?: number;
    after?: string;
    before?: string;
}
