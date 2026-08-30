export const WHATSAPP_OFFICIAL_BUSINESS_ACCOUNT_ACTIONS = Object.freeze([
    "get_official_business_account_status",
    "submit_official_business_account_application",
] as const);
export type WhatsAppOfficialBusinessAccountAction =
    (typeof WHATSAPP_OFFICIAL_BUSINESS_ACCOUNT_ACTIONS)[number];

export const WHATSAPP_OFFICIAL_BUSINESS_ACCOUNT_STATUSES = Object.freeze([
    "PENDING",
    "APPROVED",
    "REJECTED",
    "UNDER_REVIEW",
    "EXPIRED",
    "CANCELLED",
] as const);
export type WhatsAppOfficialBusinessAccountStatusName =
    (typeof WHATSAPP_OFFICIAL_BUSINESS_ACCOUNT_STATUSES)[number];

export interface WhatsAppOfficialBusinessAccountStatus {
    id: string;
    oba_status: WhatsAppOfficialBusinessAccountStatusName;
    status_message: string;
}

export interface WhatsAppOfficialBusinessAccountApplication {
    business_website_url: string;
    primary_country_of_operation: string;
    primary_language?: string;
    parent_business_or_brand?: string;
    supporting_links?: readonly string[];
    additional_supporting_information?: string;
}

export interface WhatsAppOfficialBusinessAccountApplicationResponse {
    success: boolean;
    message: string;
    updated_status?: WhatsAppOfficialBusinessAccountStatus;
    tracking_id?: string;
}
