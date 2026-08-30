export const WHATSAPP_MESSAGE_TEMPLATE_FIELDS = Object.freeze([
    "id",
    "name",
    "status",
    "category",
    "language",
    "components",
    "previous_category",
] as const);
export type WhatsAppMessageTemplateField = (typeof WHATSAPP_MESSAGE_TEMPLATE_FIELDS)[number];

export function isWhatsAppMessageTemplateField(
    value: unknown,
): value is WhatsAppMessageTemplateField {
    return (
        typeof value === "string" &&
        (WHATSAPP_MESSAGE_TEMPLATE_FIELDS as readonly string[]).includes(value)
    );
}

export const WHATSAPP_MESSAGE_TEMPLATE_CATEGORIES = Object.freeze([
    "AUTHENTICATION",
    "MARKETING",
    "UTILITY",
] as const);
export type WhatsAppMessageTemplateCategory = (typeof WHATSAPP_MESSAGE_TEMPLATE_CATEGORIES)[number];

export function isWhatsAppMessageTemplateCategory(
    value: unknown,
): value is WhatsAppMessageTemplateCategory {
    return (
        typeof value === "string" &&
        (WHATSAPP_MESSAGE_TEMPLATE_CATEGORIES as readonly string[]).includes(value)
    );
}

export const WHATSAPP_MESSAGE_TEMPLATE_STATUSES = Object.freeze([
    "APPROVED",
    "DELETED",
    "DISABLED",
    "IN_APPEAL",
    "LIMIT_EXCEEDED",
    "PAUSED",
    "PENDING",
    "PENDING_DELETION",
    "REJECTED",
] as const);
export type WhatsAppMessageTemplateStatus = (typeof WHATSAPP_MESSAGE_TEMPLATE_STATUSES)[number];

export function isWhatsAppMessageTemplateStatus(
    value: unknown,
): value is WhatsAppMessageTemplateStatus {
    return (
        typeof value === "string" &&
        (WHATSAPP_MESSAGE_TEMPLATE_STATUSES as readonly string[]).includes(value)
    );
}

export const WHATSAPP_MESSAGE_TEMPLATE_PARAMETER_FORMATS = Object.freeze([
    "NAMED",
    "POSITIONAL",
] as const);
export type WhatsAppMessageTemplateParameterFormat =
    (typeof WHATSAPP_MESSAGE_TEMPLATE_PARAMETER_FORMATS)[number];

export function isWhatsAppMessageTemplateParameterFormat(
    value: unknown,
): value is WhatsAppMessageTemplateParameterFormat {
    return (
        typeof value === "string" &&
        (WHATSAPP_MESSAGE_TEMPLATE_PARAMETER_FORMATS as readonly string[]).includes(value)
    );
}

export type WhatsAppTemplateJson =
    | null
    | boolean
    | number
    | string
    | WhatsAppTemplateJson[]
    | { [key: string]: WhatsAppTemplateJson };

/**
 * 模板组件必须有稳定 type，其余键使用可递归序列化的 JSON 扩展面。
 * Meta 可在不升 API 版本的情况下新增 OTP、Flow、Catalog 等组件字段。
 */
export type WhatsAppMessageTemplateComponent = {
    type: string;
} & Readonly<Record<string, WhatsAppTemplateJson>>;

export interface WhatsAppMessageTemplateDetails {
    id?: string;
    name?: string;
    status?: WhatsAppMessageTemplateStatus;
    category?: WhatsAppMessageTemplateCategory;
    language?: string;
    components?: WhatsAppMessageTemplateComponent[];
    previous_category?: string;
}

export interface WhatsAppMessageTemplate extends WhatsAppMessageTemplateDetails {
    id: string;
    name: string;
    status: WhatsAppMessageTemplateStatus;
    category: WhatsAppMessageTemplateCategory;
    language: string;
    components: WhatsAppMessageTemplateComponent[];
}

export interface WhatsAppMessageTemplateFieldSelection {
    fields?: readonly WhatsAppMessageTemplateField[];
}

export interface WhatsAppMessageTemplateListQuery extends WhatsAppMessageTemplateFieldSelection {
    name?: string;
    limit?: number;
    after?: string;
}

export interface WhatsAppMessageTemplatePaging {
    cursors?: {
        before?: string;
        after?: string;
    };
    previous?: string;
    next?: string;
}

export interface WhatsAppMessageTemplateListResponse {
    data: WhatsAppMessageTemplateDetails[];
    paging?: WhatsAppMessageTemplatePaging;
}

export interface WhatsAppMessageTemplateListFullResponse {
    data: WhatsAppMessageTemplate[];
    paging?: WhatsAppMessageTemplatePaging;
}

export interface WhatsAppMessageTemplateCreate {
    name: string;
    language: string;
    category: WhatsAppMessageTemplateCategory;
    components: readonly WhatsAppMessageTemplateComponent[];
    allow_category_change?: boolean;
    parameter_format?: WhatsAppMessageTemplateParameterFormat;
}

export interface WhatsAppMessageTemplateUpdate {
    name?: string;
    language?: string;
    category?: WhatsAppMessageTemplateCategory;
    components?: readonly WhatsAppMessageTemplateComponent[];
}

export interface WhatsAppMessageTemplateCreateResponse {
    id: string;
    status: WhatsAppMessageTemplateStatus;
    category: WhatsAppMessageTemplateCategory;
}

export interface WhatsAppMessageTemplateSuccessResponse {
    success: true;
}

export interface WhatsAppMessageTemplateNamespaceResponse {
    id: string;
    message_template_namespace: string;
}
