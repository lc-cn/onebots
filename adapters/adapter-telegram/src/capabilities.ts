import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    restrictAdapterEventCapabilities,
    type AdapterCapabilityManifest,
} from "onebots";
import { TELEGRAM_PLATFORM_ACTIONS } from "./platform-actions.js";
import { resolveTelegramAllowedUpdates } from "./receive-config.js";
import type { TelegramConfig, TelegramUpdateType } from "./types.js";

const reactionManagementActions = new Set([
    "delete_message_reaction",
    "delete_all_message_reactions",
]);

const platformActions = definePlatformActionCapabilities(TELEGRAM_PLATFORM_ACTIONS, action =>
    reactionManagementActions.has(action)
        ? {
              support: "native",
              availability: "permission",
              permissions: ["can_delete_messages"],
          }
        : action === "send_live_photo"
          ? { support: "native", scenes: ["private", "group", "channel"] }
          : { support: "native", availability: "context" },
);

/** Telegram Bot API 当前可用的能力。 */
export const telegramCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        ...platformActions,
        send_message: { support: "native", scenes: ["private", "group", "channel"] },
        delete_message: { support: "native", availability: "context" },
        update_message: {
            support: "native",
            availability: "context",
            note: "统一更新路径支持文本与 @；媒体/Caption 使用 call_telegram_api",
        },
        get_login_info: { support: "native" },
        get_group_info: { support: "native" },
        set_group_name: {
            support: "native",
            availability: "permission",
            permissions: ["can_change_info"],
        },
        leave_group: { support: "native" },
        get_group_member_info: { support: "native" },
        kick_group_member: {
            support: "native",
            availability: "permission",
            permissions: ["can_restrict_members"],
        },
        mute_group_member: {
            support: "native",
            availability: "permission",
            permissions: ["can_restrict_members"],
        },
        set_group_admin: {
            support: "native",
            availability: "permission",
            permissions: ["can_promote_members"],
        },
        set_group_special_title: {
            support: "native",
            availability: "permission",
            permissions: ["can_promote_members"],
        },
        handle_group_request: {
            support: "native",
            availability: "permission",
            permissions: ["can_invite_users"],
        },
        get_file: { support: "native" },
        call_telegram_api: {
            support: "native",
            availability: "context",
            note: "受当前 Bot token 权限约束的完整 grammY raw Bot API 入口",
        },
        send_poll: { support: "native", scenes: ["private", "group", "channel"] },
        forward_message: { support: "native" },
        copy_message: { support: "native" },
        set_message_reaction: { support: "native" },
        pin_message: {
            support: "native",
            availability: "permission",
            permissions: ["can_pin_messages"],
        },
        unpin_message: {
            support: "native",
            availability: "permission",
            permissions: ["can_pin_messages"],
        },
        create_chat_invite_link: {
            support: "native",
            availability: "permission",
            permissions: ["can_invite_users"],
        },
        set_chat_description: {
            support: "native",
            availability: "permission",
            permissions: ["can_change_info"],
        },
        get_chat_administrators: { support: "native" },
        get_chat_member_count: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: {
            support: "native",
            scenes: ["private", "group", "channel"],
            note: "包含 Bot API 10.0 guest_message，并在 extensions.telegram 保留 guest_query_id",
        },
        message_updated: { support: "native" },
        interaction: { support: "native" },
        user_updated: { support: "native", note: "包含 managed_bot 创建或归属变化" },
        member_joined: {
            support: "native",
            note: "包含 restricted 状态下由 is_member 表示的真实加入",
        },
        member_left: {
            support: "native",
            note: "包含 restricted 状态下由 is_member 表示的真实退出",
        },
        group_increase: { support: "native" },
        group_decrease: { support: "native" },
        group_request: { support: "native" },
        reaction_added: { support: "native" },
        reaction_removed: { support: "native" },
        message_deleted: { support: "native", note: "商业消息批量删除会拆分为独立事件" },
        native_update: {
            support: "native",
            note: "订阅、生成中止及未标准化 Update 均保留明确 kind 和 raw_event",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: {
            support: "native",
            direction: "both",
            note: "发送使用 tg://user text_link；接收投影 text_mention；@all 为文本模拟",
        },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        sticker: { support: "native", direction: "both" },
        location: { support: "native", direction: "both" },
        contact: { support: "native", direction: "both" },
        reply: { support: "native", direction: "both" },
        telegram_rich_message: {
            support: "native",
            direction: "both",
            note: "Bot API 10.3 InputRichMessage/RichMessage 原生结构，发送时不能与普通内容段混用",
        },
        telegram_live_photo: {
            support: "native",
            direction: "receive",
            note: "完整保留 Bot API LivePhoto 原生结构；发送使用 send_live_photo 双媒体动作",
        },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
        polling: { support: "native", mode: "polling" },
        manual: {
            support: "native",
            mode: "native",
            note: "通过 ingest() 或 acceptHttp(Request) 接入既有 Host",
        },
    },
});

const telegramEventUpdates = {
    message: ["message", "channel_post", "business_message", "guest_message"],
    message_updated: ["edited_message", "edited_channel_post", "edited_business_message"],
    interaction: [
        "callback_query",
        "inline_query",
        "chosen_inline_result",
        "shipping_query",
        "pre_checkout_query",
        "stopped_message_generation",
    ],
    user_updated: ["managed_bot"],
    member_joined: ["message", "channel_post", "business_message", "chat_member"],
    member_left: ["message", "channel_post", "business_message", "chat_member"],
    group_increase: ["my_chat_member"],
    group_decrease: ["my_chat_member"],
    group_request: ["chat_join_request"],
    reaction_added: ["message_reaction"],
    reaction_removed: ["message_reaction"],
    message_deleted: ["deleted_business_messages"],
} as const satisfies Partial<Record<string, readonly TelegramUpdateType[]>>;

/** 根据账号真正提交给 Telegram 的 allowed_updates 收窄事件能力。 */
export function describeTelegramCapabilities(
    config: Pick<TelegramConfig, "polling" | "receive_mode" | "webhook">,
): AdapterCapabilityManifest {
    const mode = config.receive_mode ?? "polling";
    // manual 的上游订阅不归 OneBots 管理，不能依据本地空配置推断事件范围。
    if (mode === "manual") return telegramCapabilities;
    const allowed = new Set(
        resolveTelegramAllowedUpdates(
            mode === "webhook" ? config.webhook?.allowed_updates : config.polling?.allowed_updates,
        ),
    );
    const available = new Set<string>(["native_update"]);
    for (const [event, updates] of Object.entries(telegramEventUpdates)) {
        if (updates.some(update => allowed.has(update))) available.add(event);
    }
    return restrictAdapterEventCapabilities(telegramCapabilities, available, event => {
        const updates = telegramEventUpdates[event as keyof typeof telegramEventUpdates];
        return updates
            ? `${mode}.allowed_updates 未订阅可生成此事件的 Update：${updates.join(", ")}`
            : `${mode}.allowed_updates 不会生成此 canonical 事件`;
    });
}
