import type { WhatsAppPaging } from "./types.js";

export const WHATSAPP_BUSINESS_PHONE_NUMBER_FIELDS = Object.freeze([
    "id",
    "display_phone_number",
    "verified_name",
    "status",
    "quality_rating",
    "country_code",
    "country_dial_code",
    "code_verification_status",
    "unified_cert_status",
    "account_mode",
    "host_platform",
    "messaging_limit_tier",
    "is_official_business_account",
    "username",
] as const);
export type WhatsAppBusinessPhoneNumberField =
    (typeof WHATSAPP_BUSINESS_PHONE_NUMBER_FIELDS)[number];

export const WHATSAPP_BUSINESS_PHONE_NUMBER_STATUSES = Object.freeze([
    "PENDING",
    "LINKED",
    "UNLINKED",
    "DELETED",
    "MIGRATED",
    "BANNED",
    "RESTRICTED",
] as const);
export type WhatsAppBusinessPhoneNumberStatus =
    (typeof WHATSAPP_BUSINESS_PHONE_NUMBER_STATUSES)[number];

export const WHATSAPP_BUSINESS_PHONE_NUMBER_QUALITY_RATINGS = Object.freeze([
    "GREEN",
    "YELLOW",
    "RED",
    "UNKNOWN",
] as const);
export type WhatsAppBusinessPhoneNumberQualityRating =
    (typeof WHATSAPP_BUSINESS_PHONE_NUMBER_QUALITY_RATINGS)[number];

export const WHATSAPP_BUSINESS_PHONE_NUMBER_CERT_STATUSES = Object.freeze([
    "APPROVED",
    "NAME_PENDING_REVIEW",
    "NAME_NOT_APPROVED",
    "ACCOUNT_REVIEW_NOT_STARTED",
    "LIMITED_ACCESS",
] as const);
export type WhatsAppBusinessPhoneNumberCertStatus =
    (typeof WHATSAPP_BUSINESS_PHONE_NUMBER_CERT_STATUSES)[number];

export const WHATSAPP_BUSINESS_PHONE_NUMBER_ACCOUNT_MODES = Object.freeze([
    "LIVE",
    "SANDBOX",
] as const);
export type WhatsAppBusinessPhoneNumberAccountMode =
    (typeof WHATSAPP_BUSINESS_PHONE_NUMBER_ACCOUNT_MODES)[number];

export const WHATSAPP_BUSINESS_PHONE_NUMBER_HOST_PLATFORMS = Object.freeze([
    "CLOUD_API",
    "ON_PREMISE",
    "NOT_APPLICABLE",
] as const);
export type WhatsAppBusinessPhoneNumberHostPlatform =
    (typeof WHATSAPP_BUSINESS_PHONE_NUMBER_HOST_PLATFORMS)[number];

export const WHATSAPP_BUSINESS_PHONE_NUMBER_MESSAGING_TIERS = Object.freeze([
    "TIER_50",
    "TIER_250",
    "TIER_1K",
    "TIER_10K",
    "TIER_100K",
    "TIER_UNLIMITED",
] as const);
export type WhatsAppBusinessPhoneNumberMessagingTier =
    (typeof WHATSAPP_BUSINESS_PHONE_NUMBER_MESSAGING_TIERS)[number];

export type WhatsAppBusinessPhoneNumberFilter =
    | {
          field: "account_mode";
          operator: "EQUAL";
          value: WhatsAppBusinessPhoneNumberAccountMode;
      }
    | {
          field: "messaging_limit_tier";
          operator: "EQUAL";
          value: WhatsAppBusinessPhoneNumberMessagingTier;
      }
    | {
          field: "is_official_business_account";
          operator: "EQUAL";
          value: boolean;
      };

export const WHATSAPP_BUSINESS_PHONE_NUMBER_SORTS = Object.freeze([
    "creation_time.asc",
    "creation_time.desc",
    "last_onboarded_time.asc",
    "last_onboarded_time.desc",
] as const);
export type WhatsAppBusinessPhoneNumberSort = (typeof WHATSAPP_BUSINESS_PHONE_NUMBER_SORTS)[number];

export interface WhatsAppBusinessPhoneNumber {
    id: string;
    display_phone_number: string;
    status: WhatsAppBusinessPhoneNumberStatus;
    verified_name?: string;
    quality_rating?: WhatsAppBusinessPhoneNumberQualityRating;
    country_code?: string;
    country_dial_code?: string;
    code_verification_status?: "VERIFIED" | "NOT_VERIFIED";
    unified_cert_status?: WhatsAppBusinessPhoneNumberCertStatus;
    account_mode?: WhatsAppBusinessPhoneNumberAccountMode;
    host_platform?: WhatsAppBusinessPhoneNumberHostPlatform;
    messaging_limit_tier?: WhatsAppBusinessPhoneNumberMessagingTier;
    is_official_business_account?: boolean;
    username?: string | null;
}

export interface WhatsAppBusinessPhoneNumbersQuery {
    fields?: readonly WhatsAppBusinessPhoneNumberField[];
    filters?: readonly WhatsAppBusinessPhoneNumberFilter[];
    sort?: WhatsAppBusinessPhoneNumberSort;
    limit?: number;
    after?: string;
    before?: string;
}

export interface WhatsAppBusinessPhoneNumbersResponse {
    data: WhatsAppBusinessPhoneNumber[];
    paging?: WhatsAppPaging;
}

export interface WhatsAppBusinessPhoneNumberCreateRequest {
    phone_number: string;
    verified_name: string;
    cc?: string;
    migrate_phone_number?: boolean;
    preverified_id?: string;
}

export interface WhatsAppBusinessPhoneNumberCreateResponse {
    id: string;
}
