import type { WhatsAppPaging } from "./types.js";

export const WHATSAPP_BUSINESS_ACCOUNT_FIELDS = Object.freeze([
    "id",
    "name",
    "timezone_id",
    "message_template_namespace",
    "account_review_status",
    "business_verification_status",
    "country",
    "ownership_type",
    "primary_business_location",
] as const);
export type WhatsAppBusinessAccountField = (typeof WHATSAPP_BUSINESS_ACCOUNT_FIELDS)[number];

export const WHATSAPP_BUSINESS_ACCOUNT_ACTIVITY_FIELDS = Object.freeze([
    "id",
    "activity_type",
    "timestamp",
    "actor_type",
    "actor_id",
    "actor_name",
    "description",
    "details",
    "ip_address",
    "user_agent",
] as const);
export type WhatsAppBusinessAccountActivityField =
    (typeof WHATSAPP_BUSINESS_ACCOUNT_ACTIVITY_FIELDS)[number];

export const WHATSAPP_BUSINESS_ACCOUNT_ACTIVITY_TYPES = Object.freeze([
    "ACCOUNT_CREATED",
    "ACCOUNT_UPDATED",
    "ACCOUNT_DELETED",
    "PHONE_NUMBER_ADDED",
    "PHONE_NUMBER_REMOVED",
    "PHONE_NUMBER_VERIFIED",
    "USER_ADDED",
    "USER_REMOVED",
    "USER_ROLE_CHANGED",
    "PERMISSION_GRANTED",
    "PERMISSION_REVOKED",
    "TEMPLATE_CREATED",
    "TEMPLATE_UPDATED",
    "TEMPLATE_DELETED",
    "WEBHOOK_CONFIGURED",
    "API_ACCESS_GRANTED",
    "API_ACCESS_REVOKED",
    "BILLING_UPDATED",
    "COMPLIANCE_ACTION",
    "SECURITY_EVENT",
] as const);
export type WhatsAppBusinessAccountActivityType =
    (typeof WHATSAPP_BUSINESS_ACCOUNT_ACTIVITY_TYPES)[number];

export const WHATSAPP_BUSINESS_ACCOUNT_ACTOR_TYPES = Object.freeze([
    "USER",
    "SYSTEM",
    "API",
    "ADMIN",
    "AUTOMATED_PROCESS",
] as const);
export type WhatsAppBusinessAccountActorType =
    (typeof WHATSAPP_BUSINESS_ACCOUNT_ACTOR_TYPES)[number];

export const WHATSAPP_BUSINESS_ACCOUNT_REVIEW_STATUSES = Object.freeze([
    "PENDING",
    "APPROVED",
    "REJECTED",
    "LIMIT_REACHED",
] as const);
export type WhatsAppBusinessAccountReviewStatus =
    (typeof WHATSAPP_BUSINESS_ACCOUNT_REVIEW_STATUSES)[number];

export const WHATSAPP_BUSINESS_VERIFICATION_STATUSES = Object.freeze([
    "VERIFIED",
    "UNVERIFIED",
    "PENDING",
] as const);
export type WhatsAppBusinessVerificationStatus =
    (typeof WHATSAPP_BUSINESS_VERIFICATION_STATUSES)[number];

export const WHATSAPP_BUSINESS_ACCOUNT_OWNERSHIP_TYPES = Object.freeze([
    "SELF_OWNED",
    "CLIENT_OWNED",
    "AGENCY_OWNED",
] as const);
export type WhatsAppBusinessAccountOwnershipType =
    (typeof WHATSAPP_BUSINESS_ACCOUNT_OWNERSHIP_TYPES)[number];

export interface WhatsAppBusinessAccount {
    id: string;
    name: string;
    timezone_id?: string;
    message_template_namespace?: string;
    account_review_status?: WhatsAppBusinessAccountReviewStatus;
    business_verification_status?: WhatsAppBusinessVerificationStatus;
    country?: string;
    ownership_type?: WhatsAppBusinessAccountOwnershipType;
    primary_business_location?: string;
}

export interface WhatsAppBusinessAccountUpdate {
    name?: string;
    timezone_id?: string;
}

export interface WhatsAppBusinessAccountUpdateResponse {
    success: true;
}

export type WhatsAppJsonValue =
    | string
    | number
    | boolean
    | null
    | WhatsAppJsonValue[]
    | { [key: string]: WhatsAppJsonValue };

export interface WhatsAppBusinessAccountActivity {
    id: string;
    activity_type: WhatsAppBusinessAccountActivityType;
    timestamp: string;
    actor_type: WhatsAppBusinessAccountActorType;
    actor_id?: string;
    actor_name?: string;
    description?: string;
    details?: Record<string, WhatsAppJsonValue>;
    ip_address?: string;
    user_agent?: string;
}

export interface WhatsAppBusinessAccountActivitiesQuery {
    fields?: readonly WhatsAppBusinessAccountActivityField[];
    limit?: number;
    after?: string;
    before?: string;
    since?: string;
    until?: string;
    activity_types?: readonly WhatsAppBusinessAccountActivityType[];
}

export interface WhatsAppBusinessAccountActivitiesResponse {
    data: WhatsAppBusinessAccountActivity[];
    paging?: WhatsAppPaging;
}
