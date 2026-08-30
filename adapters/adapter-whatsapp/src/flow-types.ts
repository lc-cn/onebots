export const WHATSAPP_FLOW_CATEGORIES = Object.freeze([
    "SIGN_UP",
    "SIGN_IN",
    "APPOINTMENT_BOOKING",
    "LEAD_GENERATION",
    "CONTACT_US",
    "CUSTOMER_SUPPORT",
    "SURVEY",
    "OTHER",
] as const);
export type WhatsAppFlowCategory = (typeof WHATSAPP_FLOW_CATEGORIES)[number];

export const WHATSAPP_FLOW_STATUSES = Object.freeze(["DRAFT", "PUBLISHED", "DEPRECATED"] as const);
export type WhatsAppFlowStatus = (typeof WHATSAPP_FLOW_STATUSES)[number];

export const WHATSAPP_FLOW_FIELDS = Object.freeze([
    "id",
    "name",
    "categories",
    "preview",
    "status",
    "validation_errors",
    "json_version",
    "data_api_version",
    "data_channel_uri",
    "health_status",
    "whatsapp_business_account",
    "application",
] as const);
export type WhatsAppFlowField = (typeof WHATSAPP_FLOW_FIELDS)[number];

export const WHATSAPP_FLOW_METRICS = Object.freeze([
    "ENDPOINT_REQUEST_COUNT",
    "ENDPOINT_REQUEST_ERROR",
    "ENDPOINT_REQUEST_ERROR_RATE",
    "ENDPOINT_REQUEST_LATENCY_SECONDS_CEIL",
    "ENDPOINT_AVAILABILITY",
] as const);
export type WhatsAppFlowMetricName = (typeof WHATSAPP_FLOW_METRICS)[number];

export const WHATSAPP_FLOW_METRIC_GRANULARITIES = Object.freeze(["DAY", "LIFETIME"] as const);
export type WhatsAppFlowMetricGranularity = (typeof WHATSAPP_FLOW_METRIC_GRANULARITIES)[number];

export interface WhatsAppFlowValidationError {
    error: string;
    error_type: string;
    message: string;
    line_start: number;
    line_end: number;
    column_start: number;
    column_end: number;
}

export interface WhatsAppFlowSummary {
    id: string;
    name: string;
    categories: WhatsAppFlowCategory[];
    status: WhatsAppFlowStatus;
    validation_errors: WhatsAppFlowValidationError[];
}

export interface WhatsAppFlowPaging {
    cursors?: { before?: string; after?: string };
    previous?: string;
    next?: string;
}

export interface WhatsAppFlowListResponse {
    data: WhatsAppFlowSummary[];
    paging?: WhatsAppFlowPaging;
}

export interface WhatsAppFlowPreview {
    preview_url: string;
    expires_at: string | number;
}

export interface WhatsAppFlowDetails extends Partial<WhatsAppFlowSummary> {
    json_version?: string;
    data_api_version?: string;
    data_channel_uri?: string;
    preview?: WhatsAppFlowPreview;
    health_status?: WhatsAppFlowHealthStatus;
    whatsapp_business_account?: WhatsAppFlowGraphNode;
    application?: WhatsAppFlowGraphNode;
}

export interface WhatsAppFlowGraphNode {
    id: string;
    name?: string;
    link?: string;
    [key: string]: unknown;
}

export interface WhatsAppFlowHealthError {
    error_code: number;
    error_description: string;
    possible_solution: string;
}

export interface WhatsAppFlowHealthEntity {
    entity_type: string;
    id: string;
    can_send_message: string;
    errors?: WhatsAppFlowHealthError[];
}

export interface WhatsAppFlowHealthStatus {
    can_send_message: string;
    entities: WhatsAppFlowHealthEntity[];
}

export interface WhatsAppFlowCreate {
    name: string;
    categories: readonly WhatsAppFlowCategory[];
    clone_flow_id?: string;
    endpoint_uri?: string;
}

export interface WhatsAppFlowUpdate {
    name?: string;
    categories?: readonly WhatsAppFlowCategory[];
    endpoint_uri?: string;
}

export interface WhatsAppFlowCreateResponse {
    id: string;
}

export interface WhatsAppFlowSuccessResponse {
    success: true;
}

export interface WhatsAppFlowMigrationRequest {
    source_waba_id: string;
    source_flow_names?: readonly string[];
}

export interface WhatsAppFlowMigrationResponse {
    migrated_flows: Array<{ source_id: string; source_name: string; migrated_id: string }>;
    failed_flows: Array<{ source_name: string; error_code: string; error_message: string }>;
}

export interface WhatsAppFlowAsset {
    name: string;
    asset_type: "FLOW_JSON";
    download_url: string;
}

export interface WhatsAppFlowAssetListResponse {
    data: WhatsAppFlowAsset[];
    paging?: WhatsAppFlowPaging;
}

export interface WhatsAppFlowJsonUploadResponse extends WhatsAppFlowSuccessResponse {
    validation_errors: WhatsAppFlowValidationError[];
}

export type WhatsAppFlowJson =
    | null
    | boolean
    | number
    | string
    | WhatsAppFlowJson[]
    | { [key: string]: WhatsAppFlowJson };

export interface WhatsAppFlowMetricQuery {
    name: WhatsAppFlowMetricName;
    granularity: WhatsAppFlowMetricGranularity;
    since?: string;
    until?: string;
}

export interface WhatsAppFlowMetricResponse {
    id: string;
    metric: {
        name: WhatsAppFlowMetricName;
        granularity: WhatsAppFlowMetricGranularity;
        data_points: Array<{
            timestamp: string;
            data: Array<{ key: string; value: number }>;
        }>;
    };
}

export function isWhatsAppFlowField(value: unknown): value is WhatsAppFlowField {
    return typeof value === "string" && (WHATSAPP_FLOW_FIELDS as readonly string[]).includes(value);
}

export function isWhatsAppFlowCategory(value: unknown): value is WhatsAppFlowCategory {
    return (
        typeof value === "string" && (WHATSAPP_FLOW_CATEGORIES as readonly string[]).includes(value)
    );
}

export function isWhatsAppFlowStatus(value: unknown): value is WhatsAppFlowStatus {
    return (
        typeof value === "string" && (WHATSAPP_FLOW_STATUSES as readonly string[]).includes(value)
    );
}

export function isWhatsAppFlowMetricName(value: unknown): value is WhatsAppFlowMetricName {
    return (
        typeof value === "string" && (WHATSAPP_FLOW_METRICS as readonly string[]).includes(value)
    );
}

export function isWhatsAppFlowMetricGranularity(
    value: unknown,
): value is WhatsAppFlowMetricGranularity {
    return (
        typeof value === "string" &&
        (WHATSAPP_FLOW_METRIC_GRANULARITIES as readonly string[]).includes(value)
    );
}
