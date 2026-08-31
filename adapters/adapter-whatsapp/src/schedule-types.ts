import type { WhatsAppPaging } from "./types.js";

export const WHATSAPP_SCHEDULE_FIELDS = Object.freeze([
    "id",
    "name",
    "status",
    "schedule_type",
    "description",
    "start_time",
    "end_time",
    "timezone",
    "days_of_week",
    "created_time",
    "updated_time",
    "is_active",
    "recurrence_pattern",
] as const);
export type WhatsAppScheduleField = (typeof WHATSAPP_SCHEDULE_FIELDS)[number];

export const WHATSAPP_SCHEDULE_STATUSES = Object.freeze([
    "ACTIVE",
    "INACTIVE",
    "PAUSED",
    "EXPIRED",
    "DRAFT",
] as const);
export type WhatsAppScheduleStatus = (typeof WHATSAPP_SCHEDULE_STATUSES)[number];

export const WHATSAPP_SCHEDULE_TYPES = Object.freeze([
    "BUSINESS_HOURS",
    "AUTOMATED_RESPONSE",
    "MESSAGE_CAMPAIGN",
    "MAINTENANCE_WINDOW",
    "CUSTOM",
] as const);
export type WhatsAppScheduleType = (typeof WHATSAPP_SCHEDULE_TYPES)[number];

export const WHATSAPP_SCHEDULE_DAYS = Object.freeze([
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
] as const);
export type WhatsAppScheduleDay = (typeof WHATSAPP_SCHEDULE_DAYS)[number];

export const WHATSAPP_SCHEDULE_FREQUENCIES = Object.freeze([
    "DAILY",
    "WEEKLY",
    "MONTHLY",
    "YEARLY",
] as const);
export type WhatsAppScheduleFrequency = (typeof WHATSAPP_SCHEDULE_FREQUENCIES)[number];

export interface WhatsAppScheduleRecurrence {
    frequency?: WhatsAppScheduleFrequency;
    interval?: number;
    end_date?: string;
}

export interface WhatsAppSchedule {
    id: string;
    name: string;
    status: WhatsAppScheduleStatus;
    schedule_type: WhatsAppScheduleType;
    description?: string;
    start_time?: string;
    end_time?: string;
    timezone?: string;
    days_of_week?: WhatsAppScheduleDay[];
    created_time?: string;
    updated_time?: string;
    is_active?: boolean;
    recurrence_pattern?: WhatsAppScheduleRecurrence;
}

export type WhatsAppScheduleFilter =
    | { field: "status"; operator: "EQUAL"; value: WhatsAppScheduleStatus }
    | { field: "schedule_type"; operator: "EQUAL"; value: WhatsAppScheduleType }
    | { field: "is_active"; operator: "EQUAL"; value: boolean };

export const WHATSAPP_SCHEDULE_SORTS = Object.freeze([
    "created_time.asc",
    "created_time.desc",
    "updated_time.asc",
    "updated_time.desc",
] as const);
export type WhatsAppScheduleSort = (typeof WHATSAPP_SCHEDULE_SORTS)[number];

export interface WhatsAppSchedulesQuery {
    fields?: readonly WhatsAppScheduleField[];
    filters?: readonly WhatsAppScheduleFilter[];
    sort?: WhatsAppScheduleSort;
    limit?: number;
    after?: string;
    before?: string;
}

export interface WhatsAppSchedulesResponse {
    data: WhatsAppSchedule[];
    paging?: WhatsAppPaging;
}

export interface WhatsAppScheduleCreateRequest {
    name: string;
    schedule_type: WhatsAppScheduleType;
    description?: string;
    start_time: string;
    end_time: string;
    timezone?: string;
    days_of_week?: readonly WhatsAppScheduleDay[];
    is_active?: boolean;
    recurrence_pattern?: WhatsAppScheduleRecurrence;
}

export interface WhatsAppScheduleCreateResponse {
    id: string;
}
