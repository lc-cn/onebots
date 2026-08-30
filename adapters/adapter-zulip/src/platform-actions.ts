import { definePlatformActions, type PlatformActionHandler } from "onebots";
import {
    requireInteger,
    requireMethod,
    requireParams,
    requireString,
    without,
} from "./action-params.js";
import { ZULIP_ATTACHMENT_ACTION_HANDLERS } from "./attachment-actions.js";
import { ZULIP_BOT_ACTION_HANDLERS } from "./bot-actions.js";
import { ZULIP_CHANNEL_FOLDER_ACTION_HANDLERS } from "./channel-folder-actions.js";
import { ZULIP_CHANNEL_ACTION_HANDLERS } from "./channel-actions.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";
import { ZULIP_EMOJI_ACTION_HANDLERS } from "./emoji-actions.js";
import { ZULIP_DOMAIN_ACTION_HANDLERS } from "./domain-actions.js";
import { ZULIP_DATA_EXPORT_ACTION_HANDLERS } from "./data-export-actions.js";
import { ZULIP_INVITATION_ACTION_HANDLERS } from "./invitation-actions.js";
import { ZULIP_LINKIFIER_ACTION_HANDLERS } from "./linkifier-actions.js";
import { ZULIP_MESSAGE_ACTION_HANDLERS } from "./message-actions.js";
import { ZULIP_NAVIGATION_VIEW_ACTION_HANDLERS } from "./navigation-view-actions.js";
import { ZULIP_OWN_PROFILE_ACTION_HANDLERS } from "./own-profile-actions.js";
import { ZULIP_PREFERENCE_ACTION_HANDLERS } from "./preference-actions.js";
import { ZULIP_PLAYGROUND_ACTION_HANDLERS } from "./playground-actions.js";
import { ZULIP_PROFILE_FIELD_ACTION_HANDLERS } from "./profile-field-actions.js";
import { ZULIP_USER_ACTION_HANDLERS } from "./user-actions.js";
import { ZULIP_USER_GROUP_ACTION_HANDLERS } from "./user-group-actions.js";

const ACTION_HANDLERS = {
    call_zulip_api: (client, params) =>
        client.call(
            requireString(params.path, "path"),
            requireMethod(params.method),
            requireParams(params.params),
        ),
    set_topic_visibility: (client, params) =>
        client.call("user_topics", "POST", requireParams(params)),
    update_presence: (client, params) =>
        client.call("users/me/presence", "POST", requireParams(params)),
    get_user_presence: (client, params) =>
        client.call(
            `users/${encodeURIComponent(requireString(params.user_id_or_email, "user_id_or_email"))}/presence`,
        ),
    send_typing_notification: (client, params) =>
        client.call("typing", "POST", requireParams(params)),
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
    ...ZULIP_BOT_ACTION_HANDLERS,
    ...ZULIP_ATTACHMENT_ACTION_HANDLERS,
    ...ZULIP_CHANNEL_FOLDER_ACTION_HANDLERS,
    ...ZULIP_CHANNEL_ACTION_HANDLERS,
    ...ZULIP_DATA_EXPORT_ACTION_HANDLERS,
    ...ZULIP_DOMAIN_ACTION_HANDLERS,
    ...ZULIP_EMOJI_ACTION_HANDLERS,
    ...ZULIP_INVITATION_ACTION_HANDLERS,
    ...ZULIP_LINKIFIER_ACTION_HANDLERS,
    ...ZULIP_MESSAGE_ACTION_HANDLERS,
    ...ZULIP_NAVIGATION_VIEW_ACTION_HANDLERS,
    ...ZULIP_OWN_PROFILE_ACTION_HANDLERS,
    ...ZULIP_PREFERENCE_ACTION_HANDLERS,
    ...ZULIP_PLAYGROUND_ACTION_HANDLERS,
    ...ZULIP_PROFILE_FIELD_ACTION_HANDLERS,
    ...ZULIP_USER_ACTION_HANDLERS,
    ...ZULIP_USER_GROUP_ACTION_HANDLERS,
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

const PLATFORM_ACTIONS = definePlatformActions(
    ACTION_HANDLERS,
    action =>
        new ZulipError(`未实现 Zulip 平台动作: ${action}`, {
            code: "ZULIP_ACTION_NOT_IMPLEMENTED",
        }),
);

export const ZULIP_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type ZulipPlatformAction =
    typeof ZULIP_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 执行能力清单允许的 Zulip 原生动作。 */
export async function executeZulipPlatformAction(
    client: ZulipClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(client, action, params);
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
