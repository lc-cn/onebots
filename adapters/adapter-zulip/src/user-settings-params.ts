import {
    assertHasAny,
    exactParams,
    requireBoolean,
    requireInteger,
    requireIntegerArray,
    requireString,
} from "./action-params.js";
import { ZulipError } from "./errors.js";
import type { ZulipParams } from "./types.js";

const BOOLEAN_FIELDS = [
    "twenty_four_hour_time",
    "starred_message_counts",
    "receives_typing_notifications",
    "web_suggest_update_timezone",
    "fluid_layout_width",
    "high_contrast_mode",
    "enable_drafts_synchronization",
    "translate_emoticons",
    "display_emoji_reaction_users",
    "web_escape_navigates_to_home_view",
    "left_side_userlist",
    "hide_ai_features",
    "web_inbox_show_channel_folders",
    "web_left_sidebar_show_channel_folders",
    "web_left_sidebar_unreads_count_summary",
    "enable_stream_desktop_notifications",
    "enable_stream_email_notifications",
    "enable_stream_push_notifications",
    "enable_stream_audible_notifications",
    "enable_desktop_notifications",
    "enable_sounds",
    "enable_offline_email_notifications",
    "enable_offline_push_notifications",
    "enable_online_push_notifications",
    "enable_followed_topic_desktop_notifications",
    "enable_followed_topic_email_notifications",
    "enable_followed_topic_push_notifications",
    "enable_followed_topic_audible_notifications",
    "enable_digest_emails",
    "enable_marketing_emails",
    "enable_login_emails",
    "message_content_in_email_notifications",
    "pm_content_in_desktop_notifications",
    "wildcard_mentions_notify",
    "enable_followed_topic_wildcard_mentions_notify",
    "automatically_follow_topics_where_mentioned",
    "presence_enabled",
    "enter_sends",
    "send_private_typing_notifications",
    "send_stream_typing_notifications",
    "send_read_receipts",
    "allow_private_data_export",
    "web_navigate_to_sent_message",
] as const;

const INTEGER_FIELDS = [
    "web_font_size_px",
    "web_line_height_percent",
    "email_notifications_batching_period_seconds",
] as const;

const INTEGER_ENUMS = {
    web_mark_read_on_scroll_policy: new Set([1, 2, 3]),
    web_channel_default_view: new Set([1, 2, 4]),
    color_scheme: new Set([1, 2, 3]),
    demote_inactive_streams: new Set([1, 2, 3]),
    user_list_style: new Set([1, 2, 3]),
    web_stream_unreads_count_display_policy: new Set([1, 2, 3]),
    desktop_icon_count_display: new Set([1, 2, 3, 4]),
    realm_name_in_email_notifications_policy: new Set([1, 2, 3]),
    automatically_follow_topics_policy: new Set([1, 2, 3, 4]),
    automatically_unmute_topics_in_muted_streams_policy: new Set([1, 2, 3, 4]),
    email_address_visibility: new Set([1, 2, 3, 4, 5]),
} satisfies Readonly<Record<string, ReadonlySet<number>>>;

const STRING_ENUMS = {
    web_home_view: new Set(["recent", "inbox", "all_messages"]),
    emojiset: new Set(["google", "twitter", "text"]),
    web_animate_image_previews: new Set(["always", "on_hover", "never"]),
    resolved_topic_notice_auto_read_policy: new Set(["always", "except_followed", "never"]),
} satisfies Readonly<Record<string, ReadonlySet<string>>>;

const STRING_FIELDS = [
    "full_name",
    "email",
    "old_password",
    "new_password",
    "default_language",
    "timezone",
    "notification_sound",
] as const;

const SETTING_FIELDS = [
    ...BOOLEAN_FIELDS,
    ...INTEGER_FIELDS,
    ...Object.keys(INTEGER_ENUMS),
    ...Object.keys(STRING_ENUMS),
    ...STRING_FIELDS,
] as const;
const REALM_DEFAULT_EXCLUDED_FIELDS = new Set([
    "full_name",
    "email",
    "old_password",
    "new_password",
    "default_language",
    "timezone",
    "enable_marketing_emails",
    "enable_login_emails",
    "allow_private_data_export",
]);
const REALM_DEFAULT_FIELDS = SETTING_FIELDS.filter(
    field => !REALM_DEFAULT_EXCLUDED_FIELDS.has(field),
);

export type UserSettingsMode = "self" | "bulk" | "realm_default";

/** 校验 Zulip 12+ 统一个人设置端点。 */
export function userSettingsParams(
    params: Readonly<Record<string, unknown>>,
    mode: UserSettingsMode = "self",
): ZulipParams {
    const allowed =
        mode === "bulk"
            ? ["target_users", ...SETTING_FIELDS]
            : mode === "realm_default"
              ? REALM_DEFAULT_FIELDS
              : SETTING_FIELDS;
    const input = exactParams(params, allowed);
    assertHasAny(input, mode === "realm_default" ? REALM_DEFAULT_FIELDS : SETTING_FIELDS);
    for (const field of BOOLEAN_FIELDS) {
        if (input[field] !== undefined) requireBoolean(input[field], field);
    }
    for (const field of INTEGER_FIELDS) {
        if (input[field] !== undefined) requireInteger(input[field], field);
    }
    for (const [field, values] of Object.entries(INTEGER_ENUMS)) {
        if (
            input[field] !== undefined &&
            !values.has(requireInteger(input[field], field)) &&
            !(
                mode === "realm_default" &&
                field === "web_channel_default_view" &&
                input[field] === 3
            )
        ) {
            invalid(`Zulip 参数 ${field} 不是有效选项`);
        }
    }
    for (const [field, values] of Object.entries(STRING_ENUMS)) {
        if (input[field] !== undefined && !values.has(requireString(input[field], field))) {
            invalid(`Zulip 参数 ${field} 不是有效选项`);
        }
    }
    for (const field of STRING_FIELDS) {
        if (input[field] !== undefined) requireString(input[field], field);
    }
    validatePasswordChange(input);
    if (mode === "bulk" && input.target_users !== undefined) {
        validateTargetUsers(input.target_users);
        for (const field of ["full_name", "email", "old_password", "new_password"]) {
            if (input[field] !== undefined) {
                invalid(`Zulip 批量设置不能修改身份字段 ${field}`);
            }
        }
    }
    return input;
}

function validatePasswordChange(input: ZulipParams): void {
    if (input.new_password !== undefined && input.old_password === undefined) {
        invalid("Zulip 修改密码时必须提供 old_password");
    }
}

function validateTargetUsers(value: unknown): void {
    if (!isRecord(value)) invalid("Zulip 参数 target_users 必须是对象");
    const input = exactParams(value, ["user_ids", "group_ids", "skip_if_already_edited"]);
    if (input.user_ids === undefined && input.group_ids === undefined) {
        invalid("Zulip 参数 target_users 必须指定 user_ids 或 group_ids");
    }
    if (input.user_ids !== undefined) requireIntegerArray(input.user_ids, "target_users.user_ids");
    if (input.group_ids !== undefined)
        requireIntegerArray(input.group_ids, "target_users.group_ids");
    if (input.skip_if_already_edited !== undefined) {
        requireBoolean(input.skip_if_already_edited, "target_users.skip_if_already_edited");
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
