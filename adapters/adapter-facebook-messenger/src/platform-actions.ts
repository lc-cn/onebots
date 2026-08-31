import type { MetaQueryValue } from "@onebots/meta";
import { parseAttachmentId, parseSuccess } from "./entities.js";
import { FacebookMessengerError } from "./errors.js";
import type { FacebookMessengerClient } from "./client.js";
import {
    FACEBOOK_MESSENGER_WEBHOOK_FIELDS,
    type FacebookMessengerGraphMethod,
    type FacebookMessengerMessagingType,
} from "./types.js";
import {
    assertMetaId,
    assertNumericMetaId,
    requireArray,
    requireRecord,
    requireString,
} from "./validation.js";

type Handler = (
    client: FacebookMessengerClient,
    params: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

const handlers = {
    call_facebook_messenger_api: (client, params) =>
        client.call(graphMethod(params.method), requireString(params.path, "path"), {
            query: queryRecord(params.query),
            body: params.body === undefined ? undefined : jsonValue(params.body, "body"),
        }),
    send_facebook_messenger_native: (client, params) =>
        client.send(
            assertNumericMetaId(params.recipient_id, "recipient_id"),
            structuredClone(requireRecord(params.message, "message")),
            {
                messagingType: optionalMessagingType(params.messaging_type),
                tag: optionalString(params.tag, "tag"),
                notificationType: optionalNotificationType(params.notification_type),
            },
        ),
    send_facebook_messenger_sender_action: (client, params) =>
        client.senderAction(
            assertNumericMetaId(params.recipient_id, "recipient_id"),
            senderAction(params.sender_action),
        ),
    list_facebook_messenger_conversations: (client, params) =>
        client.listConversations(
            optionalString(params.after, "after"),
            optionalLimit(params.limit),
        ),
    find_facebook_messenger_conversation: (client, params) =>
        client.findConversation(assertNumericMetaId(params.user_id, "user_id")),
    get_facebook_messenger_conversation: (client, params) =>
        client.getConversation(
            assertMetaId(params.conversation_id, "conversation_id"),
            optionalLimit(params.limit),
        ),
    get_facebook_messenger_profile: (client, params) =>
        client.call("GET", `/${client.config.page_id}/messenger_profile`, {
            query: { fields: stringList(params.fields, "fields").join(",") },
        }),
    set_facebook_messenger_profile: (client, params) =>
        client.call("POST", `/${client.config.page_id}/messenger_profile`, {
            body: structuredClone(requireRecord(params.profile, "profile")),
        }),
    delete_facebook_messenger_profile: (client, params) =>
        client.call("DELETE", `/${client.config.page_id}/messenger_profile`, {
            body: { fields: stringList(params.fields, "fields") },
        }),
    upload_facebook_messenger_attachment: async (client, params) => {
        const type = attachmentType(params.type);
        const attachmentId = await client.uploadAttachment(
            type,
            { url: requireHttpsUrl(params.url, "url") },
            params.is_reusable !== false,
        );
        return { attachment_id: parseAttachmentId({ attachment_id: attachmentId }) };
    },
    subscribe_facebook_messenger_page: async (client, params) => {
        const fields = webhookFields(params.subscribed_fields);
        return parseSuccess(
            await client.call("POST", `/${client.config.page_id}/subscribed_apps`, {
                query: { subscribed_fields: fields.join(",") },
            }),
            "subscribe Page response",
        );
    },
    get_facebook_messenger_subscribed_apps: client =>
        client.call("GET", `/${client.config.page_id}/subscribed_apps`),
    moderate_facebook_messenger_conversation: (client, params) =>
        client.call("POST", `/${client.config.page_id}/moderate_conversations`, {
            body: {
                user_ids: stringList(params.user_ids, "user_ids").map(id => ({
                    id: assertNumericMetaId(id, "user_ids[]"),
                })),
                actions: [moderationAction(params.action)],
            },
        }),
    pass_facebook_messenger_thread_control: (client, params) =>
        client.call("POST", `/${client.config.page_id}/pass_thread_control`, {
            body: {
                recipient: { id: assertNumericMetaId(params.recipient_id, "recipient_id") },
                target_app_id: assertNumericMetaId(params.target_app_id, "target_app_id"),
                ...(params.metadata === undefined
                    ? {}
                    : { metadata: requireString(params.metadata, "metadata") }),
            },
        }),
    take_facebook_messenger_thread_control: (client, params) =>
        threadControl(client, "take_thread_control", params),
    request_facebook_messenger_thread_control: (client, params) =>
        threadControl(client, "request_thread_control", params),
    get_facebook_messenger_secondary_receivers: client =>
        client.call("GET", `/${client.config.page_id}/secondary_receivers`, {
            query: { fields: "id,name" },
        }),
    search_facebook_messenger_template_library: (client, params) =>
        client.call("GET", "/message_template_library", {
            query: {
                name_or_content: requireString(params.name_or_content, "name_or_content"),
                language: requireLocale(params.language),
                limit: optionalLimit(params.limit),
                after: optionalString(params.after, "after"),
            },
        }),
    list_facebook_messenger_utility_templates: (client, params) =>
        client.call("GET", `/${client.config.page_id}/message_templates`, {
            query: {
                name: optionalString(params.name, "name"),
                limit: optionalLimit(params.limit),
                after: optionalString(params.after, "after"),
            },
        }),
    create_facebook_messenger_utility_template: (client, params) =>
        client.call("POST", `/${client.config.page_id}/message_templates`, {
            body: utilityTemplateDefinition(params.template),
        }),
    send_facebook_messenger_utility_template: (client, params) =>
        client.send(
            assertNumericMetaId(params.recipient_id, "recipient_id"),
            { template: utilityTemplateMessage(params.template) },
            { messagingType: "UTILITY" },
        ),
} satisfies Record<string, Handler>;

export const FACEBOOK_MESSENGER_PLATFORM_ACTIONS = new Set(Object.keys(handlers));

export async function executeFacebookMessengerPlatformAction(
    client: FacebookMessengerClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const handler = (handlers as Record<string, Handler>)[action];
    if (!handler) {
        throw new FacebookMessengerError(`未知 Facebook Messenger 平台动作: ${action}`, {
            code: "FACEBOOK_MESSENGER_ACTION_NOT_FOUND",
            status: 404,
        });
    }
    return handler(client, params);
}

function threadControl(
    client: FacebookMessengerClient,
    edge: "take_thread_control" | "request_thread_control",
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return client.call("POST", `/${client.config.page_id}/${edge}`, {
        body: {
            recipient: { id: assertNumericMetaId(params.recipient_id, "recipient_id") },
            ...(params.metadata === undefined
                ? {}
                : { metadata: requireString(params.metadata, "metadata") }),
        },
    });
}

function graphMethod(value: unknown): FacebookMessengerGraphMethod {
    if (value === "GET" || value === "POST" || value === "DELETE") return value;
    throw FacebookMessengerError.invalid("method 必须是 GET、POST 或 DELETE");
}

function queryRecord(value: unknown): Readonly<Record<string, MetaQueryValue>> | undefined {
    if (value === undefined) return undefined;
    const query = requireRecord(value, "query");
    const result: Record<string, MetaQueryValue> = {};
    for (const [key, item] of Object.entries(query)) {
        if (
            typeof item === "string" ||
            typeof item === "number" ||
            typeof item === "boolean" ||
            item === undefined
        ) {
            result[key] = item;
        } else if (Array.isArray(item) && item.every(entry => typeof entry === "string")) {
            result[key] = item;
        } else {
            throw FacebookMessengerError.invalid(`query.${key} 类型无效`);
        }
    }
    return result;
}

function jsonValue(value: unknown, field: string): unknown {
    try {
        return structuredClone(value);
    } catch (error) {
        throw FacebookMessengerError.invalid(`${field} 必须是可结构化克隆的数据`, {
            cause: String(error),
        });
    }
}

function stringList(value: unknown, field: string): string[] {
    const values = requireArray(value, field).map((item, index) =>
        requireString(item, `${field}[${index}]`),
    );
    if (!values.length) throw FacebookMessengerError.invalid(`${field} 不能为空`);
    if (new Set(values).size !== values.length) {
        throw FacebookMessengerError.invalid(`${field} 不能包含重复项`);
    }
    return values;
}

function webhookFields(value: unknown): string[] {
    const fields = stringList(value, "subscribed_fields");
    const supported = new Set<string>(FACEBOOK_MESSENGER_WEBHOOK_FIELDS);
    if (fields.some(field => !supported.has(field))) {
        throw FacebookMessengerError.invalid("subscribed_fields 包含当前 Messenger API 未定义字段");
    }
    return fields;
}

function optionalString(value: unknown, field: string): string | undefined {
    return value === undefined ? undefined : requireString(value, field);
}

function optionalLimit(value: unknown): number {
    if (value === undefined) return 25;
    if (!Number.isSafeInteger(value) || Number(value) < 1) {
        throw FacebookMessengerError.invalid("limit 必须是正安全整数");
    }
    return Number(value);
}

function optionalMessagingType(value: unknown): FacebookMessengerMessagingType | undefined {
    if (value === undefined) return undefined;
    if (
        value === "RESPONSE" ||
        value === "UPDATE" ||
        value === "MESSAGE_TAG" ||
        value === "UTILITY"
    ) {
        return value;
    }
    throw FacebookMessengerError.invalid("messaging_type 无效");
}

function utilityTemplateDefinition(value: unknown): Record<string, unknown> {
    const template = structuredClone(requireRecord(value, "template"));
    const name = requireTemplateName(template.name, "template.name");
    const language = requireLocale(template.language);
    if (template.category !== undefined && template.category !== "UTILITY") {
        throw FacebookMessengerError.invalid("template.category 必须是 UTILITY");
    }
    const libraryName =
        template.library_template_name === undefined
            ? undefined
            : requireTemplateName(template.library_template_name, "template.library_template_name");
    const components =
        template.components === undefined
            ? undefined
            : recordList(template.components, "template.components");
    if (!libraryName && !components?.length) {
        throw FacebookMessengerError.invalid(
            "utility template 必须包含 library_template_name 或 components",
        );
    }
    return {
        ...template,
        name,
        language,
        category: "UTILITY",
        ...(libraryName ? { library_template_name: libraryName } : {}),
        ...(components ? { components } : {}),
    };
}

function utilityTemplateMessage(value: unknown): Record<string, unknown> {
    const template = structuredClone(requireRecord(value, "template"));
    const name = requireTemplateName(template.name, "template.name");
    const languageRecord = requireRecord(template.language, "template.language");
    const code = requireLocale(languageRecord.code);
    const components =
        template.components === undefined
            ? undefined
            : recordList(template.components, "template.components");
    return {
        ...template,
        name,
        language: { ...languageRecord, code },
        ...(components ? { components } : {}),
    };
}

function recordList(value: unknown, field: string): Record<string, unknown>[] {
    return requireArray(value, field).map((item, index) =>
        structuredClone(requireRecord(item, `${field}[${index}]`)),
    );
}

function requireTemplateName(value: unknown, field: string): string {
    const name = requireString(value, field);
    if (!/^[a-z0-9_]{1,512}$/u.test(name)) {
        throw FacebookMessengerError.invalid(`${field} 必须是小写字母、数字或下划线`);
    }
    return name;
}

function requireLocale(value: unknown): string {
    const locale = requireString(value, "language");
    if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/u.test(locale)) {
        throw FacebookMessengerError.invalid("language 必须形如 en 或 en_US");
    }
    return locale;
}

function optionalNotificationType(
    value: unknown,
): "REGULAR" | "SILENT_PUSH" | "NO_PUSH" | undefined {
    if (value === undefined) return undefined;
    if (value === "REGULAR" || value === "SILENT_PUSH" || value === "NO_PUSH") return value;
    throw FacebookMessengerError.invalid("notification_type 无效");
}

function senderAction(value: unknown): "mark_seen" | "typing_on" | "typing_off" {
    if (value === "mark_seen" || value === "typing_on" || value === "typing_off") return value;
    throw FacebookMessengerError.invalid("sender_action 无效");
}

function attachmentType(value: unknown): "image" | "video" | "audio" | "file" {
    if (value === "image" || value === "video" || value === "audio" || value === "file") {
        return value;
    }
    throw FacebookMessengerError.invalid("attachment type 无效");
}

function moderationAction(
    value: unknown,
): "block_user" | "unblock_user" | "ban_user" | "unban_user" | "move_to_spam" {
    if (
        value === "block_user" ||
        value === "unblock_user" ||
        value === "ban_user" ||
        value === "unban_user" ||
        value === "move_to_spam"
    ) {
        return value;
    }
    throw FacebookMessengerError.invalid("moderation action 无效");
}

function requireHttpsUrl(value: unknown, field: string): string {
    const raw = requireString(value, field);
    if (!URL.canParse(raw)) throw FacebookMessengerError.invalid(`${field} 不是有效 URL`);
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) {
        throw FacebookMessengerError.invalid(`${field} 必须是无凭据 HTTPS URL`);
    }
    return url.toString();
}
