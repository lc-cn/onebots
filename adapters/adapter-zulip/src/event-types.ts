import type { ZulipAttachment, ZulipEventMessageType, ZulipMessage } from "./types.js";
import type { ZulipActivityEvent } from "./activity-event-types.js";
import type {
    ZulipDraftsEvent,
    ZulipRemindersEvent,
    ZulipSavedSnippetsEvent,
    ZulipScheduledMessagesEvent,
} from "./personal-event-types.js";

export * from "./personal-event-types.js";
export * from "./activity-event-types.js";

/** Zulip Event Queue 当前公开的事件类型。保留完整清单，供类型和配置界面共用。 */
export const ZULIP_EVENT_TYPES = [
    "alert_words",
    "attachment",
    "channel_folder",
    "custom_profile_fields",
    "default_stream_groups",
    "default_streams",
    "delete_message",
    "device",
    "drafts",
    "has_webex_token",
    "has_zoom_token",
    "heartbeat",
    "invites_changed",
    "message",
    "muted_topics",
    "muted_users",
    "navigation_view",
    "onboarding_steps",
    "presence",
    "reaction",
    "realm",
    "realm_bot",
    "realm_domains",
    "realm_emoji",
    "realm_export",
    "realm_export_consent",
    "realm_filters",
    "realm_linkifiers",
    "realm_playgrounds",
    "realm_user",
    "realm_user_settings_defaults",
    "reminders",
    "restart",
    "saved_snippets",
    "scheduled_messages",
    "stream",
    "submessage",
    "subscription",
    "typing",
    "typing_edit_message",
    "update_message",
    "update_message_flags",
    "user_group",
    "user_settings",
    "user_status",
    "user_topic",
    "web_reload_client",
] as const;

export type ZulipEventType = (typeof ZULIP_EVENT_TYPES)[number];

export interface ZulipBaseEvent {
    id: number;
    type: string;
    [key: string]: unknown;
}

export interface ZulipMessageEvent extends ZulipBaseEvent {
    type: "message";
    message: ZulipMessage;
    flags?: string[];
}

export interface ZulipUpdateMessageEvent extends ZulipBaseEvent {
    type: "update_message";
    message_id: number;
    user_id: number;
    edit_timestamp: number;
    stream_id?: number;
    topic?: string;
    orig_topic?: string;
    content?: string;
    rendered_content?: string;
}

export interface ZulipDeleteMessageEvent extends ZulipBaseEvent {
    type: "delete_message";
    message_id: number;
    message_type?: ZulipEventMessageType;
    stream_id?: number;
    topic?: string;
}

export interface ZulipReactionEvent extends ZulipBaseEvent {
    type: "reaction";
    op: "add" | "remove";
    message_id: number;
    emoji_name: string;
    emoji_code: string;
    reaction_type: string;
    user_id: number;
    user?: { email?: string; full_name?: string; user_id: number };
}

export interface ZulipUpdateMessageFlagsEvent extends ZulipBaseEvent {
    type: "update_message_flags";
    op: "add" | "remove";
    flag: string;
    messages: number[];
    all?: boolean;
    message_details?: Record<string, Record<string, unknown>>;
}

export interface ZulipHeartbeatEvent extends ZulipBaseEvent {
    type: "heartbeat";
}

export interface ZulipRealmUserEvent extends ZulipBaseEvent {
    type: "realm_user";
    op: "add" | "update" | "remove";
    person?: Record<string, unknown>;
    person_id?: number;
}

export interface ZulipInvitesChangedEvent extends ZulipBaseEvent {
    type: "invites_changed";
}

export interface ZulipAlertWordsEvent extends ZulipBaseEvent {
    type: "alert_words";
    alert_words: string[];
}

export interface ZulipMutedUsersEvent extends ZulipBaseEvent {
    type: "muted_users";
    muted_users: Array<{ id: number; timestamp: number }>;
}

export interface ZulipAttachmentChangedEvent extends ZulipBaseEvent {
    type: "attachment";
    op: "add" | "update";
    attachment: ZulipAttachment;
    upload_space_used: number;
}

export interface ZulipAttachmentRemovedEvent extends ZulipBaseEvent {
    type: "attachment";
    op: "remove";
    attachment: Pick<ZulipAttachment, "id">;
    upload_space_used: number;
}

export type ZulipAttachmentEvent = ZulipAttachmentChangedEvent | ZulipAttachmentRemovedEvent;

export interface ZulipEventChannel extends Record<string, unknown> {
    stream_id: number;
    name: string;
}

export interface ZulipStreamCreateEvent extends ZulipBaseEvent {
    type: "stream";
    op: "create";
    streams: ZulipEventChannel[];
}

export interface ZulipStreamDeleteEvent extends ZulipBaseEvent {
    type: "stream";
    op: "delete";
    /** Zulip 10+ 的 canonical 删除字段；不声明已废弃的 streams。 */
    stream_ids: number[];
}

export interface ZulipStreamUpdateEvent extends ZulipBaseEvent {
    type: "stream";
    op: "update";
    stream_id: number;
    name: string;
    property: string;
    value: unknown;
    rendered_description?: string;
    history_public_to_subscribers?: boolean;
    is_web_public?: boolean;
}

export type ZulipStreamEvent =
    | ZulipStreamCreateEvent
    | ZulipStreamDeleteEvent
    | ZulipStreamUpdateEvent;

export interface ZulipSubscriptionAddEvent extends ZulipBaseEvent {
    type: "subscription";
    op: "add";
    subscriptions: ZulipEventChannel[];
}

export interface ZulipSubscriptionRemoveEvent extends ZulipBaseEvent {
    type: "subscription";
    op: "remove";
    subscriptions: Array<Pick<ZulipEventChannel, "stream_id" | "name">>;
}

export interface ZulipSubscriptionUpdateEvent extends ZulipBaseEvent {
    type: "subscription";
    op: "update";
    stream_id: number;
    property: string;
    value: number | boolean | string;
}

export interface ZulipSubscriptionPeerEvent extends ZulipBaseEvent {
    type: "subscription";
    op: "peer_add" | "peer_remove";
    stream_ids: number[];
    user_ids: number[];
}

export type ZulipSubscriptionEvent =
    | ZulipSubscriptionAddEvent
    | ZulipSubscriptionRemoveEvent
    | ZulipSubscriptionUpdateEvent
    | ZulipSubscriptionPeerEvent;

export interface ZulipChannelFolder {
    id: number;
    name: string;
    order: number;
    date_created: number | null;
    creator_id: number | null;
    description: string;
    rendered_description: string;
    is_archived: boolean;
}

export interface ZulipChannelFolderAddEvent extends ZulipBaseEvent {
    type: "channel_folder";
    op: "add";
    channel_folder: ZulipChannelFolder;
}

export interface ZulipChannelFolderUpdateEvent extends ZulipBaseEvent {
    type: "channel_folder";
    op: "update";
    channel_folder_id: number;
    data: Partial<
        Pick<ZulipChannelFolder, "name" | "description" | "rendered_description" | "is_archived">
    > &
        Record<string, unknown>;
}

export interface ZulipChannelFoldersReorderEvent extends ZulipBaseEvent {
    type: "channel_folder";
    op: "reorder";
    order: number[];
}

export type ZulipChannelFolderEvent =
    | ZulipChannelFolderAddEvent
    | ZulipChannelFolderUpdateEvent
    | ZulipChannelFoldersReorderEvent;

export interface ZulipNavigationView {
    fragment: string;
    is_pinned: boolean;
    name?: string | null;
}

export interface ZulipNavigationViewAddEvent extends ZulipBaseEvent {
    type: "navigation_view";
    op: "add";
    navigation_view: ZulipNavigationView;
}

export interface ZulipNavigationViewUpdateEvent extends ZulipBaseEvent {
    type: "navigation_view";
    op: "update";
    fragment: string;
    data: {
        name?: string | null;
        is_pinned?: boolean | null;
    } & Record<string, unknown>;
}

export interface ZulipNavigationViewRemoveEvent extends ZulipBaseEvent {
    type: "navigation_view";
    op: "remove";
    fragment: string;
}

export type ZulipNavigationViewEvent =
    | ZulipNavigationViewAddEvent
    | ZulipNavigationViewUpdateEvent
    | ZulipNavigationViewRemoveEvent;

export interface ZulipUserGroupEvent extends ZulipBaseEvent {
    type: "user_group";
    op:
        | "add"
        | "update"
        | "remove"
        | "add_members"
        | "remove_members"
        | "add_subgroups"
        | "remove_subgroups";
    group?: Record<string, unknown>;
    group_id?: number;
    data?: Record<string, unknown>;
    user_ids?: number[];
    direct_subgroup_ids?: number[];
}

export interface ZulipRealmEmoji {
    id: string;
    name: string;
    source_url: string;
    still_url?: string | null;
    deactivated: boolean;
    author_id: number | null;
}

export interface ZulipRealmEmojiAddEvent extends ZulipBaseEvent {
    type: "realm_emoji";
    op: "add";
    emoji: ZulipRealmEmoji;
}

export interface ZulipRealmEmojiUpdateEvent extends ZulipBaseEvent {
    type: "realm_emoji";
    op: "update_one";
    emoji_id: string;
    data: Partial<Pick<ZulipRealmEmoji, "deactivated">> & Record<string, unknown>;
}

export interface ZulipCustomProfileField {
    id: number;
    type: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
    order: number;
    name: string;
    hint: string;
    field_data?: string;
    display_in_profile_summary?: boolean;
    required: boolean;
    editable_by_user: boolean;
    use_for_user_matching?: boolean;
}

export interface ZulipCustomProfileFieldsEvent extends ZulipBaseEvent {
    type: "custom_profile_fields";
    fields: ZulipCustomProfileField[];
}

export interface ZulipRealmDomain {
    domain: string;
    allow_subdomains: boolean;
}

export interface ZulipRealmDomainsEvent extends ZulipBaseEvent {
    type: "realm_domains";
    op: "add" | "change" | "remove";
    realm_domain?: ZulipRealmDomain;
    domain?: string;
}

export interface ZulipCodePlayground {
    id: number;
    name: string;
    pygments_language: string;
    url_template: string;
}

export interface ZulipRealmPlaygroundsEvent extends ZulipBaseEvent {
    type: "realm_playgrounds";
    realm_playgrounds: ZulipCodePlayground[];
}

export type ZulipDataExportType = "public" | "full_with_consent" | "full_without_consent";

export interface ZulipDataExport {
    id: number;
    acting_user_id: number;
    export_time: number;
    deleted_timestamp: number | null;
    failed_timestamp: number | null;
    export_url: string | null;
    pending: boolean;
    export_from_prior_server: boolean;
    export_type: ZulipDataExportType;
}

export interface ZulipRealmExportEvent extends ZulipBaseEvent {
    type: "realm_export";
    exports: ZulipDataExport[];
}

export interface ZulipRealmExportConsentEvent extends ZulipBaseEvent {
    type: "realm_export_consent";
    user_id: number;
    consented: boolean;
}

export type ZulipEvent =
    | ZulipActivityEvent
    | ZulipMessageEvent
    | ZulipUpdateMessageEvent
    | ZulipDeleteMessageEvent
    | ZulipReactionEvent
    | ZulipUpdateMessageFlagsEvent
    | ZulipHeartbeatEvent
    | ZulipRealmUserEvent
    | ZulipInvitesChangedEvent
    | ZulipAlertWordsEvent
    | ZulipMutedUsersEvent
    | ZulipAttachmentEvent
    | ZulipStreamEvent
    | ZulipSubscriptionEvent
    | ZulipScheduledMessagesEvent
    | ZulipRemindersEvent
    | ZulipSavedSnippetsEvent
    | ZulipDraftsEvent
    | ZulipChannelFolderEvent
    | ZulipNavigationViewEvent
    | ZulipUserGroupEvent
    | ZulipRealmEmojiAddEvent
    | ZulipRealmEmojiUpdateEvent
    | ZulipCustomProfileFieldsEvent
    | ZulipRealmDomainsEvent
    | ZulipRealmPlaygroundsEvent
    | ZulipRealmExportEvent
    | ZulipRealmExportConsentEvent
    | ZulipBaseEvent;
