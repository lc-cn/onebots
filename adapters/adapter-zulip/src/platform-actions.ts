import { definePlatformActions, type PlatformActionHandler } from "onebots";
import { requireMethod, requireParams, requireString } from "./action-params.js";
import { ZULIP_ATTACHMENT_ACTION_HANDLERS } from "./attachment-actions.js";
import { ZULIP_ACTIVITY_ACTION_HANDLERS } from "./activity-actions.js";
import { ZULIP_BOT_ACTION_HANDLERS } from "./bot-actions.js";
import { ZULIP_CHANNEL_FOLDER_ACTION_HANDLERS } from "./channel-folder-actions.js";
import { ZULIP_CHANNEL_ACTION_HANDLERS } from "./channel-actions.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";
import { ZULIP_EMOJI_ACTION_HANDLERS } from "./emoji-actions.js";
import { ZULIP_DOMAIN_ACTION_HANDLERS } from "./domain-actions.js";
import { ZULIP_DATA_EXPORT_ACTION_HANDLERS } from "./data-export-actions.js";
import { ZULIP_DRAFT_ACTION_HANDLERS } from "./draft-actions.js";
import { ZULIP_INVITATION_ACTION_HANDLERS } from "./invitation-actions.js";
import { ZULIP_LINKIFIER_ACTION_HANDLERS } from "./linkifier-actions.js";
import { ZULIP_LIFECYCLE_ACTION_HANDLERS } from "./lifecycle-actions.js";
import { ZULIP_MESSAGE_ACTION_HANDLERS } from "./message-actions.js";
import { ZULIP_NAVIGATION_VIEW_ACTION_HANDLERS } from "./navigation-view-actions.js";
import { ZULIP_OWN_PROFILE_ACTION_HANDLERS } from "./own-profile-actions.js";
import { ZULIP_PREFERENCE_ACTION_HANDLERS } from "./preference-actions.js";
import { ZULIP_PLAYGROUND_ACTION_HANDLERS } from "./playground-actions.js";
import { ZULIP_PROFILE_FIELD_ACTION_HANDLERS } from "./profile-field-actions.js";
import { ZULIP_REMINDER_ACTION_HANDLERS } from "./reminder-actions.js";
import { ZULIP_SAVED_SNIPPET_ACTION_HANDLERS } from "./saved-snippet-actions.js";
import { ZULIP_SCHEDULED_MESSAGE_ACTION_HANDLERS } from "./scheduled-message-actions.js";
import { ZULIP_USER_ACTION_HANDLERS } from "./user-actions.js";
import { ZULIP_USER_GROUP_ACTION_HANDLERS } from "./user-group-actions.js";
import { ZULIP_VIDEO_CALL_ACTION_HANDLERS } from "./video-call-actions.js";

const ACTION_HANDLERS = {
    call_zulip_api: (client, params) =>
        client.call(
            requireString(params.path, "path"),
            requireMethod(params.method),
            requireParams(params.params),
        ),
    get_server_settings: client => client.call("server_settings"),
    ...ZULIP_BOT_ACTION_HANDLERS,
    ...ZULIP_ACTIVITY_ACTION_HANDLERS,
    ...ZULIP_ATTACHMENT_ACTION_HANDLERS,
    ...ZULIP_CHANNEL_FOLDER_ACTION_HANDLERS,
    ...ZULIP_CHANNEL_ACTION_HANDLERS,
    ...ZULIP_DATA_EXPORT_ACTION_HANDLERS,
    ...ZULIP_DRAFT_ACTION_HANDLERS,
    ...ZULIP_DOMAIN_ACTION_HANDLERS,
    ...ZULIP_EMOJI_ACTION_HANDLERS,
    ...ZULIP_INVITATION_ACTION_HANDLERS,
    ...ZULIP_LINKIFIER_ACTION_HANDLERS,
    ...ZULIP_LIFECYCLE_ACTION_HANDLERS,
    ...ZULIP_MESSAGE_ACTION_HANDLERS,
    ...ZULIP_NAVIGATION_VIEW_ACTION_HANDLERS,
    ...ZULIP_OWN_PROFILE_ACTION_HANDLERS,
    ...ZULIP_PREFERENCE_ACTION_HANDLERS,
    ...ZULIP_PLAYGROUND_ACTION_HANDLERS,
    ...ZULIP_PROFILE_FIELD_ACTION_HANDLERS,
    ...ZULIP_REMINDER_ACTION_HANDLERS,
    ...ZULIP_SAVED_SNIPPET_ACTION_HANDLERS,
    ...ZULIP_SCHEDULED_MESSAGE_ACTION_HANDLERS,
    ...ZULIP_USER_ACTION_HANDLERS,
    ...ZULIP_USER_GROUP_ACTION_HANDLERS,
    ...ZULIP_VIDEO_CALL_ACTION_HANDLERS,
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
