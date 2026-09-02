import type { MetaQueryValue } from "@onebots/meta";
import { definePlatformActionContract, type PlatformActionHandler } from "onebots";
import type { InstagramClient } from "./client.js";
import { parseAttachmentId, parseSuccess } from "./entities.js";
import { InstagramError } from "./errors.js";
import {
    INSTAGRAM_WEBHOOK_FIELDS,
    type InstagramGraphMethod,
    type InstagramOutgoingMessage,
} from "./types.js";
import {
    assertHttpsUrl,
    assertMetaId,
    assertNumericMetaId,
    requireArray,
    requireRecord,
    requireString,
} from "./validation.js";

const handlers = {
    call_instagram_api: (client, params) =>
        client.call(graphMethod(params.method), requireString(params.path, "path"), {
            query: queryRecord(params.query),
            body: params.body === undefined ? undefined : cloneValue(params.body, "body"),
        }),
    send_instagram_native: (client, params) =>
        client.send(
            assertNumericMetaId(params.recipient_id, "recipient_id"),
            cloneMessage(params.message),
        ),
    send_instagram_human_agent: (client, params) =>
        client.send(
            assertNumericMetaId(params.recipient_id, "recipient_id"),
            cloneMessage(params.message),
            { humanAgent: true },
        ),
    send_instagram_private_reply: (client, params) =>
        client.sendPrivateReply(
            assertNumericMetaId(params.comment_id, "comment_id"),
            requireString(params.text, "text"),
        ),
    react_instagram_message: (client, params) =>
        client.react(
            assertNumericMetaId(params.recipient_id, "recipient_id"),
            assertMetaId(params.message_id, "message_id"),
            reactionAction(params.action),
        ),
    send_instagram_media_share: (client, params) =>
        client.send(assertNumericMetaId(params.recipient_id, "recipient_id"), {
            attachment: {
                type: "MEDIA_SHARE",
                payload: { id: assertNumericMetaId(params.media_id, "media_id") },
            },
        }),
    send_instagram_like_heart: (client, params) =>
        client.send(assertNumericMetaId(params.recipient_id, "recipient_id"), {
            attachment: { type: "like_heart" },
        }),
    list_instagram_conversations: (client, params) =>
        client.listConversations(
            optionalString(params.after, "after"),
            optionalLimit(params.limit),
        ),
    find_instagram_conversation: (client, params) =>
        client.findConversation(assertNumericMetaId(params.user_id, "user_id")),
    get_instagram_conversation: (client, params) =>
        client.getConversation(
            assertMetaId(params.conversation_id, "conversation_id"),
            optionalMessageLimit(params.limit),
        ),
    get_instagram_messenger_profile: (client, params) =>
        client.call("GET", `/${client.config.instagram_user_id}/messenger_profile`, {
            query: { fields: profileFields(params.fields).join(",") },
        }),
    set_instagram_messenger_profile: (client, params) =>
        client.call("POST", `/${client.config.instagram_user_id}/messenger_profile`, {
            body: profileBody(params.profile),
        }),
    delete_instagram_messenger_profile: (client, params) =>
        client.call("DELETE", `/${client.config.instagram_user_id}/messenger_profile`, {
            body: { fields: profileFields(params.fields) },
        }),
    upload_instagram_attachment: async (client, params) => {
        const attachmentId = await client.uploadAttachment(
            attachmentType(params.type),
            { url: assertHttpsUrl(params.url, "url") },
            params.is_reusable !== false,
        );
        return { attachment_id: parseAttachmentId({ attachment_id: attachmentId }) };
    },
    subscribe_instagram_webhooks: async (client, params) => {
        const fields = webhookFields(params.subscribed_fields);
        return parseSuccess(
            await client.call("POST", `/${client.config.instagram_user_id}/subscribed_apps`, {
                query: { subscribed_fields: fields.join(",") },
            }),
            "subscribe Instagram webhook response",
        );
    },
    get_instagram_subscribed_apps: client =>
        client.call("GET", `/${client.config.instagram_user_id}/subscribed_apps`),
    delete_instagram_webhook_subscription: async client =>
        parseSuccess(
            await client.call("DELETE", `/${client.config.instagram_user_id}/subscribed_apps`),
            "delete Instagram webhook subscription response",
        ),
    list_instagram_welcome_message_flows: (client, params) =>
        client.call("GET", `/${client.config.instagram_user_id}/welcome_message_flows`, {
            query: { flow_id: optionalMetaId(params.flow_id, "flow_id") },
        }),
    create_instagram_welcome_message_flow: (client, params) =>
        client.call("POST", `/${client.config.instagram_user_id}/welcome_message_flows`, {
            body: welcomeFlow(params.flow, false),
        }),
    update_instagram_welcome_message_flow: (client, params) =>
        client.call("POST", `/${client.config.instagram_user_id}/welcome_message_flows`, {
            query: { flow_id: assertMetaId(params.flow_id, "flow_id") },
            body: welcomeFlow(params.flow, true),
        }),
    delete_instagram_welcome_message_flow: async (client, params) =>
        parseSuccess(
            await client.call(
                "DELETE",
                `/${client.config.instagram_user_id}/welcome_message_flows`,
                {
                    query: { flow_id: assertMetaId(params.flow_id, "flow_id") },
                },
            ),
            "delete Instagram welcome message flow response",
        ),
} satisfies Readonly<Record<string, PlatformActionHandler<InstagramClient>>>;

const parameters = {
    call_instagram_api: ["method", "path", "query", "body"],
    send_instagram_native: ["recipient_id", "message"],
    send_instagram_human_agent: ["recipient_id", "message"],
    send_instagram_private_reply: ["comment_id", "text"],
    react_instagram_message: ["recipient_id", "message_id", "action"],
    send_instagram_media_share: ["recipient_id", "media_id"],
    send_instagram_like_heart: ["recipient_id"],
    list_instagram_conversations: ["after", "limit"],
    find_instagram_conversation: ["user_id"],
    get_instagram_conversation: ["conversation_id", "limit"],
    get_instagram_messenger_profile: ["fields"],
    set_instagram_messenger_profile: ["profile"],
    delete_instagram_messenger_profile: ["fields"],
    upload_instagram_attachment: ["type", "url", "is_reusable"],
    subscribe_instagram_webhooks: ["subscribed_fields"],
    get_instagram_subscribed_apps: [],
    delete_instagram_webhook_subscription: [],
    list_instagram_welcome_message_flows: ["flow_id"],
    create_instagram_welcome_message_flow: ["flow"],
    update_instagram_welcome_message_flow: ["flow_id", "flow"],
    delete_instagram_welcome_message_flow: ["flow_id"],
} satisfies { readonly [TAction in keyof typeof handlers]: readonly string[] };

const actions = definePlatformActionContract(handlers, parameters, {
    unsupported: action =>
        new InstagramError(`未知 Instagram 平台动作: ${action}`, {
            code: "INSTAGRAM_ACTION_NOT_FOUND",
            status: 404,
        }),
    unexpectedParameter: (action, parameter) =>
        InstagramError.invalid(`Instagram 动作 ${action} 不接受参数 ${parameter}`),
});

export const INSTAGRAM_PLATFORM_ACTIONS = actions.actions;
export type InstagramPlatformAction =
    typeof INSTAGRAM_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

export async function executeInstagramPlatformAction(
    client: InstagramClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return actions.execute(client, action, params);
}

function graphMethod(value: unknown): InstagramGraphMethod {
    if (value === "GET" || value === "POST" || value === "DELETE") return value;
    throw InstagramError.invalid("method 必须是 GET、POST 或 DELETE");
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
            throw InstagramError.invalid(`query.${key} 类型无效`);
        }
    }
    return result;
}

function cloneValue(value: unknown, field: string): unknown {
    try {
        return structuredClone(value);
    } catch (error) {
        throw InstagramError.invalid(`${field} 必须是可结构化克隆的数据`, {
            cause: String(error),
        });
    }
}

function cloneMessage(value: unknown): InstagramOutgoingMessage {
    return structuredClone(requireRecord(value, "message")) as InstagramOutgoingMessage;
}

function stringList(value: unknown, field: string): string[] {
    const values = requireArray(value, field).map((item, index) =>
        requireString(item, `${field}[${index}]`),
    );
    if (!values.length) throw InstagramError.invalid(`${field} 不能为空`);
    if (new Set(values).size !== values.length) {
        throw InstagramError.invalid(`${field} 不能包含重复项`);
    }
    return values;
}

function webhookFields(value: unknown): string[] {
    const fields = stringList(value, "subscribed_fields");
    const supported = new Set<string>(INSTAGRAM_WEBHOOK_FIELDS);
    if (fields.some(field => !supported.has(field))) {
        throw InstagramError.invalid("subscribed_fields 包含当前 Instagram API 未定义字段");
    }
    return fields;
}

function profileFields(value: unknown): string[] {
    const fields = stringList(value, "fields");
    if (fields.some(field => field !== "persistent_menu" && field !== "ice_breakers")) {
        throw InstagramError.invalid(
            "Messenger Profile fields 仅支持 persistent_menu 与 ice_breakers",
        );
    }
    return fields;
}

function profileBody(value: unknown): Record<string, unknown> {
    const profile = structuredClone(requireRecord(value, "profile"));
    const allowed = new Set(["platform", "persistent_menu", "ice_breakers"]);
    const unexpected = Object.keys(profile).find(field => !allowed.has(field));
    if (unexpected) throw InstagramError.invalid(`profile 不接受字段 ${unexpected}`);
    if (profile.platform !== undefined && profile.platform !== "instagram") {
        throw InstagramError.invalid("profile.platform 必须是 instagram");
    }
    if (profile.persistent_menu === undefined && profile.ice_breakers === undefined) {
        throw InstagramError.invalid("profile 必须包含 persistent_menu 或 ice_breakers");
    }
    if (profile.persistent_menu !== undefined) {
        profile.persistent_menu = requireArray(
            profile.persistent_menu,
            "profile.persistent_menu",
        ).map((item, index) => profileLocale(item, `profile.persistent_menu[${index}]`));
    }
    if (profile.ice_breakers !== undefined) {
        const iceBreakers = requireArray(profile.ice_breakers, "profile.ice_breakers");
        if (!iceBreakers.length || iceBreakers.length > 4) {
            throw InstagramError.invalid("profile.ice_breakers 必须包含 1 到 4 项");
        }
        profile.ice_breakers = iceBreakers.map((item, index) =>
            profileIceBreaker(item, `profile.ice_breakers[${index}]`),
        );
    }
    return { ...profile, platform: "instagram" };
}

function profileLocale(value: unknown, field: string): Record<string, unknown> {
    const locale = structuredClone(requireRecord(value, field));
    requireString(locale.locale, `${field}.locale`);
    const actions = requireArray(locale.call_to_actions, `${field}.call_to_actions`);
    if (!actions.length) throw InstagramError.invalid(`${field}.call_to_actions 不能为空`);
    locale.call_to_actions = actions.map((item, index) =>
        profileMenuAction(item, `${field}.call_to_actions[${index}]`),
    );
    return locale;
}

function profileMenuAction(value: unknown, field: string): Record<string, unknown> {
    const action = structuredClone(requireRecord(value, field));
    const type = requireString(action.type, `${field}.type`);
    requireString(action.title, `${field}.title`);
    if (type === "postback") requireString(action.payload, `${field}.payload`);
    else if (type === "web_url") action.url = assertHttpsUrl(action.url, `${field}.url`);
    else throw InstagramError.invalid(`${field}.type 必须是 postback 或 web_url`);
    return action;
}

function profileIceBreaker(value: unknown, field: string): Record<string, unknown> {
    const action = structuredClone(requireRecord(value, field));
    requireString(action.question, `${field}.question`);
    requireString(action.payload, `${field}.payload`);
    return action;
}

function welcomeFlow(value: unknown, updating: boolean): Record<string, unknown> {
    const flow = structuredClone(requireRecord(value, "flow"));
    const name = requireString(flow.name, "flow.name");
    const messages = requireArray(flow.welcome_message_flow, "flow.welcome_message_flow").map(
        (item, index) =>
            structuredClone(requireRecord(item, `flow.welcome_message_flow[${index}]`)),
    );
    if (!messages.length) throw InstagramError.invalid("flow.welcome_message_flow 不能为空");
    if (updating && flow.eligible_platforms !== undefined) {
        throw InstagramError.invalid("更新 Welcome Message Flow 时不接受 eligible_platforms");
    }
    return updating
        ? { ...flow, name, welcome_message_flow: messages }
        : {
              ...flow,
              name,
              welcome_message_flow: messages,
              eligible_platforms: ["instagram"],
          };
}

function optionalString(value: unknown, field: string): string | undefined {
    return value === undefined ? undefined : requireString(value, field);
}

function optionalMetaId(value: unknown, field: string): string | undefined {
    return value === undefined ? undefined : assertMetaId(value, field);
}

function optionalLimit(value: unknown): number {
    if (value === undefined) return 25;
    if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 100) {
        throw InstagramError.invalid("limit 必须是 1 到 100 的安全整数");
    }
    return Number(value);
}

function optionalMessageLimit(value: unknown): number {
    if (value === undefined) return 20;
    if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 20) {
        throw InstagramError.invalid("message limit 必须是 1 到 20 的安全整数");
    }
    return Number(value);
}

function attachmentType(value: unknown): "image" | "video" | "audio" {
    if (value === "image" || value === "video" || value === "audio") return value;
    throw InstagramError.invalid("attachment type 必须是 image、video 或 audio");
}

function reactionAction(value: unknown): "react" | "unreact" {
    if (value === "react" || value === "unreact") return value;
    throw InstagramError.invalid("reaction action 必须是 react 或 unreact");
}
