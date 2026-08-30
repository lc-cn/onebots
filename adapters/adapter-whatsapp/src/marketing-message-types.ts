import type { WhatsAppTemplateJson } from "./message-template-types.js";

export const WHATSAPP_MARKETING_MESSAGE_ACTIONS = Object.freeze([
    "send_marketing_message",
] as const);
export type WhatsAppMarketingMessageAction = (typeof WHATSAPP_MARKETING_MESSAGE_ACTIONS)[number];

export const WHATSAPP_MARKETING_PRODUCT_POLICIES = Object.freeze([
    "CLOUD_API_FALLBACK",
    "STRICT",
] as const);
export type WhatsAppMarketingProductPolicy = (typeof WHATSAPP_MARKETING_PRODUCT_POLICIES)[number];

export const WHATSAPP_MARKETING_MESSAGE_STATUSES = Object.freeze([
    "accepted",
    "held_for_quality_assessment",
    "paused",
] as const);
export type WhatsAppMarketingMessageStatus = (typeof WHATSAPP_MARKETING_MESSAGE_STATUSES)[number];

export type WhatsAppMarketingTemplateParameter = {
    type: string;
} & Readonly<Record<string, WhatsAppTemplateJson>>;

export type WhatsAppMarketingTemplateComponent =
    | {
          type: "header" | "body";
          parameters?: readonly WhatsAppMarketingTemplateParameter[];
      }
    | {
          type: "button";
          sub_type: "quick_reply" | "url" | "catalog";
          index: string;
          parameters: readonly WhatsAppMarketingTemplateParameter[];
      };

export interface WhatsAppMarketingTemplate {
    name: string;
    language: {
        policy?: "deterministic";
        code: string;
    };
    components?: readonly WhatsAppMarketingTemplateComponent[];
}

export interface WhatsAppMarketingMessageRequest {
    to: string;
    template: WhatsAppMarketingTemplate;
    product_policy?: WhatsAppMarketingProductPolicy;
    message_activity_sharing?: boolean;
}

export interface WhatsAppMarketingMessageResponse {
    messaging_product: "whatsapp";
    contacts?: Array<{ input: string; wa_id: string }>;
    messages: Array<{ id: string; message_status?: WhatsAppMarketingMessageStatus }>;
    success?: boolean;
}
