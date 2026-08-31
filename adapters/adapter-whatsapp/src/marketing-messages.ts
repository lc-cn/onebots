import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import {
    normalizeTemplateComponents,
    normalizeTemplateJsonRecord,
} from "./message-template-json.js";
import {
    WHATSAPP_MARKETING_MESSAGE_STATUSES,
    WHATSAPP_MARKETING_PRODUCT_POLICIES,
    type WhatsAppMarketingMessageRequest,
    type WhatsAppMarketingMessageResponse,
    type WhatsAppMarketingMessageStatus,
    type WhatsAppMarketingProductPolicy,
    type WhatsAppMarketingTemplate,
    type WhatsAppMarketingTemplateComponent,
    type WhatsAppMarketingTemplateParameter,
} from "./marketing-message-types.js";

export * from "./marketing-message-types.js";

/** 专用 Marketing Messages 端点；与普通 messages 模板发送保持语义隔离。 */
export class WhatsAppMarketingMessages {
    constructor(private readonly client: WhatsAppClient) {}

    async send(
        request: WhatsAppMarketingMessageRequest,
    ): Promise<WhatsAppMarketingMessageResponse> {
        const message = marketingRequest(request);
        return marketingResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.phone_number_id}/marketing_messages`,
                body: {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    type: "template",
                    ...message,
                },
            }),
        );
    }
}

const MARKETING_MESSAGE_ACTION_HANDLERS = {
    send_marketing_message: (client: WhatsAppClient, params: Readonly<Record<string, unknown>>) =>
        client.marketingMessages.send(marketingRequest(params.message)),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Marketing Message 动作的执行与参数契约单一来源。 */
export const WHATSAPP_MARKETING_MESSAGE_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    MARKETING_MESSAGE_ACTION_HANDLERS,
    { send_marketing_message: ["message"] },
);

export type WhatsAppMarketingMessageAction =
    keyof typeof WHATSAPP_MARKETING_MESSAGE_ACTION_HANDLERS;

export function isWhatsAppMarketingMessageAction(
    action: string,
): action is WhatsAppMarketingMessageAction {
    return Object.hasOwn(WHATSAPP_MARKETING_MESSAGE_ACTION_HANDLERS, action);
}

function marketingRequest(value: unknown): WhatsAppMarketingMessageRequest {
    const source = inputRecord(value, "message");
    rejectUnknown(source, ["to", "template", "product_policy", "message_activity_sharing"]);
    return {
        to: recipient(source.to),
        template: marketingTemplate(source.template),
        ...(source.product_policy === undefined
            ? {}
            : { product_policy: productPolicy(source.product_policy) }),
        ...(source.message_activity_sharing === undefined
            ? {}
            : {
                  message_activity_sharing: inputBoolean(
                      source.message_activity_sharing,
                      "message_activity_sharing",
                  ),
              }),
    };
}

function marketingTemplate(value: unknown): WhatsAppMarketingTemplate {
    const source = inputRecord(value, "template");
    rejectUnknown(source, ["name", "language", "components"]);
    return {
        name: templateName(source.name),
        language: templateLanguage(source.language),
        ...(source.components === undefined
            ? {}
            : { components: templateComponents(source.components) }),
    };
}

function templateLanguage(value: unknown): WhatsAppMarketingTemplate["language"] {
    const source = inputRecord(value, "template.language");
    rejectUnknown(source, ["policy", "code"]);
    if (source.policy !== undefined && source.policy !== "deterministic") {
        invalidParameter("template.language.policy 仅支持 deterministic");
    }
    const code = inputText(source.code, "template.language.code");
    if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/u.test(code)) {
        invalidParameter("template.language.code 必须是语言码或 language_COUNTRY locale");
    }
    return { policy: "deterministic", code };
}

function templateComponents(value: unknown): WhatsAppMarketingTemplateComponent[] {
    return normalizeTemplateComponents(value).map((component, index) => {
        const source = inputRecord(component, `template.components[${index}]`);
        rejectUnknown(source, ["type", "sub_type", "index", "parameters"]);
        if (source.type === "header" || source.type === "body") {
            if (source.sub_type !== undefined || source.index !== undefined) {
                invalidParameter(`template.components[${index}] 只有 button 可携带 sub_type/index`);
            }
            return {
                type: source.type,
                ...(source.parameters === undefined
                    ? {}
                    : { parameters: templateParameters(source.parameters, index) }),
            };
        }
        if (source.type !== "button") {
            invalidParameter(`template.components[${index}].type 必须是 header/body/button`);
        }
        const subType = buttonSubtype(
            inputText(source.sub_type, `template.components[${index}].sub_type`),
        );
        const buttonIndex = inputText(source.index, `template.components[${index}].index`);
        if (!/^\d$/u.test(buttonIndex)) {
            invalidParameter(`template.components[${index}].index 必须是 0 到 9 的字符串`);
        }
        return {
            type: "button",
            sub_type: subType,
            index: buttonIndex,
            parameters: templateParameters(source.parameters, index),
        };
    });
}

function buttonSubtype(value: string): "quick_reply" | "url" | "catalog" {
    if (value === "quick_reply" || value === "url" || value === "catalog") return value;
    invalidParameter(`不支持 button sub_type: ${value}`);
}

function templateParameters(
    value: unknown,
    componentIndex: number,
): WhatsAppMarketingTemplateParameter[] {
    if (!Array.isArray(value) || !value.length) {
        invalidParameter(`template.components[${componentIndex}].parameters 必须是非空数组`);
    }
    return value.map((parameter, parameterIndex) => {
        const name = `template.components[${componentIndex}].parameters[${parameterIndex}]`;
        const source = normalizeTemplateJsonRecord(parameter, name);
        return {
            ...source,
            type: inputText(source.type, `${name}.type`),
        };
    });
}

function marketingResponse(value: unknown): WhatsAppMarketingMessageResponse {
    const source = responseRecord(value);
    if (source.messaging_product !== "whatsapp" || !Array.isArray(source.messages)) {
        invalidResponse(value);
    }
    const messages = source.messages.map(messageResponse);
    if (!messages.length) invalidResponse(value);
    return {
        messaging_product: "whatsapp",
        messages,
        ...(source.contacts === undefined ? {} : { contacts: contactsResponse(source.contacts) }),
        ...(source.success === undefined
            ? {}
            : { success: responseBoolean(source.success, value) }),
    };
}

function messageResponse(value: unknown): {
    id: string;
    message_status?: WhatsAppMarketingMessageStatus;
} {
    const source = responseRecord(value);
    return {
        id: responseText(source.id, value),
        ...(source.message_status === undefined
            ? {}
            : { message_status: responseStatus(source.message_status, value) }),
    };
}

function contactsResponse(value: unknown): Array<{ input: string; wa_id: string }> {
    if (!Array.isArray(value)) invalidResponse(value);
    return value.map(contact => {
        const source = responseRecord(contact);
        return {
            input: responseText(source.input, contact),
            wa_id: responseText(source.wa_id, contact),
        };
    });
}

function responseStatus(value: unknown, root: unknown): WhatsAppMarketingMessageStatus {
    if (
        typeof value !== "string" ||
        !(WHATSAPP_MARKETING_MESSAGE_STATUSES as readonly string[]).includes(value)
    ) {
        invalidResponse(root);
    }
    return value as WhatsAppMarketingMessageStatus;
}

function productPolicy(value: unknown): WhatsAppMarketingProductPolicy {
    if (
        typeof value !== "string" ||
        !(WHATSAPP_MARKETING_PRODUCT_POLICIES as readonly string[]).includes(value)
    ) {
        invalidParameter(`不支持 product_policy: ${String(value)}`);
    }
    return value as WhatsAppMarketingProductPolicy;
}

function templateName(value: unknown): string {
    const name = inputText(value, "template.name");
    if (name.length > 512 || !/^[a-z0-9_]+$/u.test(name)) {
        invalidParameter("template.name 必须是最长 512 字符的小写字母、数字或下划线");
    }
    return name;
}

function recipient(value: unknown): string {
    const to = inputText(value, "to");
    if (!/^\d{5,20}$/u.test(to)) invalidParameter("to 必须是 5 到 20 位数字的 WhatsApp ID");
    return to;
}

function inputBoolean(value: unknown, name: string): boolean {
    if (typeof value !== "boolean") invalidParameter(`${name} 必须是布尔值`);
    return value;
}

function responseBoolean(value: unknown, root: unknown): boolean {
    if (typeof value !== "boolean") invalidResponse(root);
    return value;
}

function inputText(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 必须是非空字符串`);
    return value.trim();
}

function responseText(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !value) invalidResponse(root);
    return value;
}

function inputRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        invalidParameter(`${name} 必须是对象`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function responseRecord(value: unknown): Readonly<Record<string, unknown>> {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse(value);
    return value as Readonly<Record<string, unknown>>;
}

function rejectUnknown(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) invalidParameter(`不支持字段: ${unknown.join(", ")}`);
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp Marketing Message 响应结构无效", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}
