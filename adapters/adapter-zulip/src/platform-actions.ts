import { definePlatformActions, type PlatformActionHandler } from "onebots";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";
import type { ZulipHttpMethod, ZulipParam, ZulipParams } from "./types.js";

const ACTION_HANDLERS = {
    call_zulip_api: (client, params) =>
        client.call(
            requireString(params.path, "path"),
            requireMethod(params.method),
            requireParams(params.params),
        ),
    add_reaction: (client, params) => reaction(client, params, "add"),
    remove_reaction: (client, params) => reaction(client, params, "remove"),
    star_message: (client, params) => messageFlag(client, params, "add"),
    unstar_message: (client, params) => messageFlag(client, params, "remove"),
    get_messages: (client, params) => client.call("messages", "GET", requireParams(params)),
    get_message_edit_history: (client, params) =>
        client.call(`messages/${requireInteger(params.message_id, "message_id")}/history`),
    get_message_read_receipts: (client, params) =>
        client.call(`messages/${requireInteger(params.message_id, "message_id")}/read_receipts`),
    render_message: (client, params) =>
        client.call("messages/render", "POST", requireParams(params)),
    subscribe_channels: (client, params) =>
        client.call("users/me/subscriptions", "POST", requireParams(params)),
    unsubscribe_channels: (client, params) =>
        client.call("users/me/subscriptions", "DELETE", requireParams(params)),
    get_channel_subscribers: (client, params) =>
        client.call(`streams/${requireInteger(params.stream_id, "stream_id")}/members`),
    create_zulip_channel: (client, params) =>
        client.call("channels/create", "POST", requireParams(params)),
    update_zulip_channel: (client, params) =>
        client.call(
            `streams/${requireInteger(params.stream_id, "stream_id")}`,
            "PATCH",
            without(params, "stream_id"),
        ),
    archive_channel: (client, params) => archiveChannel(client, params, true),
    unarchive_channel: (client, params) => archiveChannel(client, params, false),
    set_topic_visibility: (client, params) =>
        client.call("user_topics", "POST", requireParams(params)),
    update_presence: (client, params) =>
        client.call("users/me/presence", "POST", requireParams(params)),
    get_user_presence: (client, params) =>
        client.call(
            `users/${encodeURIComponent(requireString(params.user_id_or_email, "user_id_or_email"))}/presence`,
        ),
    update_user_status: (client, params) =>
        client.call("users/me/status", "POST", requireParams(params)),
    send_typing_notification: (client, params) =>
        client.call("typing", "POST", requireParams(params)),
    get_custom_emoji: client => client.call("realm/emoji"),
    get_attachments: client => client.call("attachments"),
    get_server_settings: client => client.call("server_settings"),
    get_scheduled_messages: client => client.call("scheduled_messages"),
    create_scheduled_message: (client, params) =>
        client.call("scheduled_messages", "POST", requireParams(params)),
    edit_scheduled_message: (client, params) =>
        resourceAction(client, "scheduled_messages", "scheduled_message_id", "PATCH", params),
    delete_scheduled_message: (client, params) =>
        resourceAction(client, "scheduled_messages", "scheduled_message_id", "DELETE", params),
    get_drafts: client => client.call("drafts"),
    create_drafts: (client, params) => client.call("drafts", "POST", requireParams(params)),
    edit_draft: (client, params) => resourceAction(client, "drafts", "draft_id", "PATCH", params),
    delete_draft: (client, params) =>
        resourceAction(client, "drafts", "draft_id", "DELETE", params),
    get_reminders: client => client.call("reminders"),
    create_reminder: (client, params) => client.call("reminders", "POST", requireParams(params)),
    delete_reminder: (client, params) =>
        resourceAction(client, "reminders", "reminder_id", "DELETE", params),
    get_saved_snippets: client => client.call("saved_snippets"),
    create_saved_snippet: (client, params) =>
        client.call("saved_snippets", "POST", requireParams(params)),
    edit_saved_snippet: (client, params) =>
        resourceAction(client, "saved_snippets", "saved_snippet_id", "PATCH", params),
    delete_saved_snippet: (client, params) =>
        resourceAction(client, "saved_snippets", "saved_snippet_id", "DELETE", params),
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

const PLATFORM_ACTIONS = definePlatformActions(
    ACTION_HANDLERS,
    action =>
        new ZulipError(`未实现 Zulip 平台动作: ${action}`, {
            code: "ZULIP_ACTION_NOT_IMPLEMENTED",
        }),
);

export const ZULIP_PLATFORM_ACTIONS: ReadonlySet<string> = PLATFORM_ACTIONS.actions;

/** 执行能力清单允许的 Zulip 原生动作。 */
export async function executeZulipPlatformAction(
    client: ZulipClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(client, action, params);
}

function reaction(
    client: ZulipClient,
    params: Readonly<Record<string, unknown>>,
    operation: "add" | "remove",
): Promise<unknown> {
    return client.setReaction(
        requireInteger(params.message_id, "message_id"),
        operation,
        requireString(params.emoji_name, "emoji_name"),
        optionalString(params.emoji_code),
        optionalString(params.reaction_type),
    );
}

function messageFlag(
    client: ZulipClient,
    params: Readonly<Record<string, unknown>>,
    operation: "add" | "remove",
): Promise<unknown> {
    return client.updateMessageFlag(
        [requireInteger(params.message_id, "message_id")],
        operation,
        "starred",
    );
}

function archiveChannel(
    client: ZulipClient,
    params: Readonly<Record<string, unknown>>,
    archived: boolean,
): Promise<unknown> {
    return client.call(`streams/${requireInteger(params.stream_id, "stream_id")}`, "PATCH", {
        is_archived: archived,
    });
}

function resourceAction(
    client: ZulipClient,
    collection: string,
    idField: string,
    method: "PATCH" | "DELETE",
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const id = requireInteger(params[idField], idField);
    return client.call(`${collection}/${id}`, method, without(params, idField));
}

function requireMethod(value: unknown): ZulipHttpMethod {
    if (value === undefined) return "GET";
    if (value === "GET" || value === "POST" || value === "PATCH" || value === "DELETE") {
        return value;
    }
    throw new ZulipError("Zulip method 必须是 GET、POST、PATCH 或 DELETE", {
        code: "ZULIP_INVALID_ACTION_PARAM",
    });
}

function requireParams(value: unknown): ZulipParams {
    const source = isRecord(value) && "params" in value ? value.params : value;
    if (!isRecord(source)) {
        throw new ZulipError("Zulip params 必须是对象", {
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
    }
    const result: Record<string, ZulipParam | undefined> = {};
    for (const [key, item] of Object.entries(source)) {
        if (!isZulipParam(item)) {
            throw new ZulipError(`Zulip 参数 ${key} 不是可编码的值`, {
                code: "ZULIP_INVALID_ACTION_PARAM",
            });
        }
        result[key] = item;
    }
    return result;
}

function without(value: Readonly<Record<string, unknown>>, key: string): ZulipParams {
    const copy = { ...value };
    delete copy[key];
    return requireParams(copy);
}

function requireString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new ZulipError(`Zulip 参数 ${name} 必须是非空字符串`, {
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
    }
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function requireInteger(value: unknown, name: string): number {
    const result = typeof value === "string" ? Number(value) : value;
    if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) {
        throw new ZulipError(`Zulip 参数 ${name} 必须是非负整数`, {
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isZulipParam(value: unknown): value is ZulipParam | undefined {
    return (
        value === undefined ||
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        Array.isArray(value) ||
        isRecord(value)
    );
}
