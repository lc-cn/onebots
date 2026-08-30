import type { PlatformActionHandler } from "onebots";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";

export const WHATSAPP_WEBHOOK_SUBSCRIPTION_ACTIONS = Object.freeze([
    "list_webhook_subscriptions",
    "subscribe_waba_webhooks",
    "unsubscribe_waba_webhooks",
] as const);
export type WhatsAppWebhookSubscriptionAction =
    (typeof WHATSAPP_WEBHOOK_SUBSCRIPTION_ACTIONS)[number];

export const WHATSAPP_SUBSCRIBED_APP_FIELDS = Object.freeze(["id", "name", "link"] as const);
export type WhatsAppSubscribedAppField = (typeof WHATSAPP_SUBSCRIBED_APP_FIELDS)[number];

export interface WhatsAppSubscribedAppData {
    id: string;
    name?: string;
    link?: string;
}

export interface WhatsAppWebhookSubscription {
    whatsapp_business_api_data: WhatsAppSubscribedAppData;
    override_callback_uri?: string;
}

export interface WhatsAppWebhookSubscriptionsResponse {
    data: WhatsAppWebhookSubscription[];
}

export interface WhatsAppWebhookSubscriptionRequest {
    override_callback_uri?: string;
    verify_token?: string;
}

export interface WhatsAppWebhookSubscriptionMutationResponse {
    success: true;
    data?: WhatsAppWebhookSubscription[];
}

export function isWhatsAppWebhookSubscriptionAction(
    action: string,
): action is WhatsAppWebhookSubscriptionAction {
    return (WHATSAPP_WEBHOOK_SUBSCRIPTION_ACTIONS as readonly string[]).includes(action);
}

/** WABA Webhook App 订阅控制面；verify token 只存在于写请求。 */
export class WhatsAppWebhookSubscriptions {
    constructor(private readonly client: WhatsAppClient) {}

    async list(
        fields: readonly WhatsAppSubscribedAppField[] = WHATSAPP_SUBSCRIBED_APP_FIELDS,
    ): Promise<WhatsAppWebhookSubscriptionsResponse> {
        const selection = fieldSelection(fields);
        return listResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.business_account_id}/subscribed_apps`,
                query: { fields: selection.join(",") },
            }),
            selection,
        );
    }

    async subscribe(
        request: WhatsAppWebhookSubscriptionRequest = {},
    ): Promise<WhatsAppWebhookSubscriptionMutationResponse> {
        return mutationResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.business_account_id}/subscribed_apps`,
                body: subscriptionRequest(request),
            }),
            WHATSAPP_SUBSCRIBED_APP_FIELDS,
        );
    }

    async unsubscribe(): Promise<WhatsAppWebhookSubscriptionMutationResponse> {
        return mutationResponse(
            await this.client.call<unknown>({
                method: "DELETE",
                resource: `${this.client.config.business_account_id}/subscribed_apps`,
            }),
            WHATSAPP_SUBSCRIBED_APP_FIELDS,
        );
    }

    execute(
        action: WhatsAppWebhookSubscriptionAction,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        switch (action) {
            case "list_webhook_subscriptions":
                rejectUnknown(params, ["fields"]);
                return this.list(
                    params.fields === undefined
                        ? WHATSAPP_SUBSCRIBED_APP_FIELDS
                        : fieldSelection(params.fields),
                );
            case "subscribe_waba_webhooks":
                rejectUnknown(params, ["subscription"]);
                return this.subscribe(
                    params.subscription === undefined
                        ? {}
                        : subscriptionRequest(params.subscription),
                );
            case "unsubscribe_waba_webhooks":
                rejectUnknown(params, []);
                return this.unsubscribe();
        }
    }
}

export const WHATSAPP_WEBHOOK_SUBSCRIPTION_ACTION_HANDLERS = Object.fromEntries(
    WHATSAPP_WEBHOOK_SUBSCRIPTION_ACTIONS.map(action => [
        action,
        (client: WhatsAppClient, params: Readonly<Record<string, unknown>>) =>
            client.webhookSubscriptions.execute(action, params),
    ]),
) as Record<WhatsAppWebhookSubscriptionAction, PlatformActionHandler<WhatsAppClient>>;

function subscriptionRequest(value: unknown): WhatsAppWebhookSubscriptionRequest {
    const source = inputRecord(value, "subscription");
    rejectUnknown(source, ["override_callback_uri", "verify_token"]);
    return {
        ...(source.override_callback_uri === undefined
            ? {}
            : { override_callback_uri: httpsUrl(source.override_callback_uri) }),
        ...(source.verify_token === undefined
            ? {}
            : { verify_token: boundedString(source.verify_token, "verify_token", 1024) }),
    };
}

function fieldSelection(value: unknown): WhatsAppSubscribedAppField[] {
    if (!Array.isArray(value) || !value.length) invalidParameter("fields 必须是非空数组");
    const fields = value.map(field => {
        if (
            typeof field !== "string" ||
            !(WHATSAPP_SUBSCRIBED_APP_FIELDS as readonly string[]).includes(field)
        ) {
            invalidParameter(`不支持 Subscribed App 字段: ${String(field)}`);
        }
        return field as WhatsAppSubscribedAppField;
    });
    return [...new Set(["id" as const, ...fields])];
}

function listResponse(
    value: unknown,
    fields: readonly WhatsAppSubscribedAppField[],
): WhatsAppWebhookSubscriptionsResponse {
    const source = responseRecord(value, value);
    if (!Array.isArray(source.data)) invalidResponse(value);
    return { data: source.data.map(item => subscription(item, fields, value)) };
}

function mutationResponse(
    value: unknown,
    fields: readonly WhatsAppSubscribedAppField[],
): WhatsAppWebhookSubscriptionMutationResponse {
    const source = responseRecord(value, value);
    if (source.success !== true) invalidResponse(value);
    if (source.data !== undefined && !Array.isArray(source.data)) invalidResponse(value);
    return {
        success: true,
        ...(Array.isArray(source.data)
            ? { data: source.data.map(item => subscription(item, fields, value)) }
            : {}),
    };
}

function subscription(
    value: unknown,
    fields: readonly WhatsAppSubscribedAppField[],
    root: unknown,
): WhatsAppWebhookSubscription {
    const source = responseRecord(value, root);
    const app = responseRecord(source.whatsapp_business_api_data, root);
    const data: WhatsAppSubscribedAppData = {
        id: responseNumericId(app.id, root),
        ...(fields.includes("name") ? { name: responseString(app.name, root) } : {}),
        ...(fields.includes("link") ? { link: responseHttpsUrl(app.link, root) } : {}),
    };
    return {
        whatsapp_business_api_data: data,
        ...(source.override_callback_uri === undefined
            ? {}
            : { override_callback_uri: responseHttpsUrl(source.override_callback_uri, root) }),
    };
}

function httpsUrl(value: unknown): string {
    const url = boundedString(value, "override_callback_uri", 2048);
    if (!URL.canParse(url)) invalidParameter("override_callback_uri 必须是有效 HTTPS URL");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        invalidParameter("override_callback_uri 必须是无凭据的 HTTPS URL");
    }
    return parsed.toString();
}

function boundedString(value: unknown, name: string, max: number): string {
    if (typeof value !== "string" || !value.trim() || [...value].length > max) {
        invalidParameter(`${name} 必须是 1–${max} 字符的非空字符串`);
    }
    return value;
}

function responseNumericId(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !/^\d+$/u.test(value)) invalidResponse(root);
    return value;
}

function responseString(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !value) invalidResponse(root);
    return value;
}

function responseHttpsUrl(value: unknown, root: unknown): string {
    const url = responseString(value, root);
    if (!URL.canParse(url)) invalidResponse(root);
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) invalidResponse(root);
    return url;
}

function inputRecord(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        invalidParameter(`${name} 必须是对象`);
    }
    return value as Record<string, unknown>;
}

function responseRecord(value: unknown, root: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse(root);
    return value as Record<string, unknown>;
}

function rejectUnknown(
    source: Readonly<Record<string, unknown>>,
    allowed: readonly string[],
): void {
    const unknown = Object.keys(source).find(key => !allowed.includes(key));
    if (unknown) invalidParameter(`Webhook Subscription 参数包含未知字段: ${unknown}`);
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp Webhook Subscription 响应不符合官方结构", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
