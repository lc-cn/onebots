import type { Chat, Message, ReactionType, Update, User } from "grammy/types";
import { CommonEvent, type CommonTypes } from "onebots";
import type { TelegramEventProjectorContext } from "./event-context.js";
import { projectTelegramSegments } from "./message-segments.js";

export type { TelegramEventProjectorContext } from "./event-context.js";

/**
 * 将一个 Telegram Update 投影为零到多个 CommonEvent。
 * Reaction diff、批量删除等 Update 天然包含多个事实，不能压扁成单一事件。
 */
export function projectTelegramEvents(
    update: Update,
    context: TelegramEventProjectorContext,
): CommonEvent.Event<Update>[] {
    const message = update.message ?? update.channel_post ?? update.business_message ?? undefined;
    if (message) {
        const membership = projectServiceMembership(update, message, context);
        if (membership.length) return membership;
        const projected = projectMessage(update, message, context);
        if (projected.message.length) return [projected];
        return [
            projectNotice(update, context, "custom", {
                user: message.from ? projectUser(message.from, context) : undefined,
                group: projectGroup(message, context),
                message_id: context.createId(message.message_id),
                extensions: { telegram: { kind: serviceMessageKind(message) } },
            }),
        ];
    }

    const edited =
        update.edited_message ??
        update.edited_channel_post ??
        update.edited_business_message ??
        undefined;
    if (edited) {
        return [
            projectNotice(update, context, "message_updated", {
                message_id: context.createId(edited.message_id),
                message: projectTelegramSegments(edited, context),
                user: edited.from ? projectUser(edited.from, context) : undefined,
                group: projectGroup(edited, context),
            }),
        ];
    }

    const interaction = projectInteraction(update, context);
    if (interaction) return [interaction];

    if (update.chat_join_request) {
        const request = update.chat_join_request;
        return [
            {
                ...baseEvent(update, context),
                type: "request",
                request_type: "group",
                sub_type: "add",
                user: projectUser(request.from, context),
                group: {
                    id: context.createId(request.chat.id),
                    name: request.chat.title ?? request.chat.username ?? "",
                },
                comment: request.bio,
                flag: `${request.chat.id}:${request.from.id}`,
            },
        ];
    }

    const memberUpdate = update.chat_member ?? update.my_chat_member;
    if (memberUpdate) {
        const previous = memberUpdate.old_chat_member.status;
        const current = memberUpdate.new_chat_member.status;
        const wasMember = isChatMember(memberUpdate.old_chat_member);
        const isMember = isChatMember(memberUpdate.new_chat_member);
        const isSelfMembership = Boolean(update.my_chat_member);
        const isGroup = memberUpdate.chat.type !== "private";
        const noticeType =
            isGroup && isMember !== wasMember
                ? isSelfMembership
                    ? isMember
                        ? "group_increase"
                        : "group_decrease"
                    : isMember
                      ? "member_joined"
                      : "member_left"
                : "custom";
        return [
            projectNotice(update, context, noticeType, {
                user: projectUser(memberUpdate.new_chat_member.user, context),
                operator: projectUser(memberUpdate.from, context),
                group: projectGroupFromChat(memberUpdate.chat, context),
                sub_type: current,
                extensions: {
                    telegram: {
                        kind: isSelfMembership ? "my_chat_member" : "chat_member",
                        previous_status: previous,
                        current_status: current,
                    },
                },
            }),
        ];
    }

    if (update.message_reaction) {
        const reaction = update.message_reaction;
        const oldKeys = new Set(reaction.old_reaction.map(reactionKey));
        const newKeys = new Set(reaction.new_reaction.map(reactionKey));
        const added = reaction.new_reaction.filter(value => !oldKeys.has(reactionKey(value)));
        const removed = reaction.old_reaction.filter(value => !newKeys.has(reactionKey(value)));
        return [
            ...added.map((value, index) =>
                projectReaction(update, context, "reaction_added", value, index),
            ),
            ...removed.map((value, index) =>
                projectReaction(update, context, "reaction_removed", value, added.length + index),
            ),
        ];
    }

    if (update.deleted_business_messages) {
        const deleted = update.deleted_business_messages;
        return deleted.message_ids.map((messageId, index) =>
            projectNotice(
                update,
                context,
                "message_deleted",
                {
                    message_id: context.createId(messageId),
                    group: {
                        id: context.createId(deleted.chat.id),
                        name: deleted.chat.title ?? deleted.chat.username ?? "",
                    },
                    extensions: {
                        telegram: { business_connection_id: deleted.business_connection_id },
                    },
                },
                `deleted:${index}`,
            ),
        );
    }

    // 其余原生 Update 仍作为 custom notice 无损交付，避免 SDK 升级前丢事件。
    const kind = Object.keys(update).find(key => key !== "update_id");
    if (!kind) return [];
    return [
        projectNotice(update, context, "custom", {
            extensions: { telegram: { kind } },
        }),
    ];
}

function projectInteraction(
    update: Update,
    context: TelegramEventProjectorContext,
): CommonEvent.Notice<Update> | undefined {
    const source =
        update.callback_query ??
        update.inline_query ??
        update.chosen_inline_result ??
        update.shipping_query ??
        update.pre_checkout_query;
    if (!source) return undefined;
    const kind = Object.keys(update).find(key => key !== "update_id") ?? "interaction";
    return projectNotice(update, context, "interaction", {
        user: projectUser(source.from, context),
        message_id:
            "message" in source && source.message
                ? context.createId(source.message.message_id)
                : undefined,
        extensions: { telegram: { kind, interaction: source } },
    });
}

function projectReaction(
    update: Update,
    context: TelegramEventProjectorContext,
    noticeType: "reaction_added" | "reaction_removed",
    reactionValue: ReactionType,
    index: number,
): CommonEvent.Notice<Update> {
    const reaction = update.message_reaction!;
    return projectNotice(
        update,
        context,
        noticeType,
        {
            message_id: context.createId(reaction.message_id),
            user: reaction.user ? projectUser(reaction.user, context) : undefined,
            group: {
                id: context.createId(reaction.chat.id),
                name: reaction.chat.title ?? reaction.chat.username ?? "",
            },
            extensions: {
                telegram: {
                    reaction: reactionValue,
                    actor_chat: reaction.actor_chat,
                },
            },
        },
        `reaction:${index}`,
    );
}

function reactionKey(value: object): string {
    return JSON.stringify(value);
}

function projectMessage(
    update: Update,
    message: Message,
    context: TelegramEventProjectorContext,
): CommonEvent.Message<Update> {
    const chatType = message.chat.type;
    const sender = message.from;
    return {
        ...baseEvent(update, context, message.date),
        type: "message",
        message_type:
            chatType === "private" ? "private" : chatType === "channel" ? "channel" : "group",
        sender: sender
            ? projectUser(sender, context)
            : {
                  id: context.createId(message.sender_chat?.id ?? message.chat.id),
                  name: message.sender_chat?.title ?? message.chat.title ?? "",
              },
        group: projectGroup(message, context),
        message: projectTelegramSegments(message, context),
        raw_message: message.text ?? message.caption ?? "",
        message_id: context.createId(message.message_id),
    };
}

function projectUser(user: User, context: TelegramEventProjectorContext): CommonTypes.User {
    return {
        id: context.createId(user.id),
        name: user.username ?? [user.first_name, user.last_name].filter(Boolean).join(" "),
    };
}

function projectGroup(
    message: Message,
    context: TelegramEventProjectorContext,
): CommonTypes.Group | undefined {
    if (message.chat.type === "private") return undefined;
    return {
        id: context.createId(message.chat.id),
        name: message.chat.title ?? "",
    };
}

function projectGroupFromChat(
    chat: Chat,
    context: TelegramEventProjectorContext,
): CommonTypes.Group | undefined {
    if (chat.type === "private") return undefined;
    return {
        id: context.createId(chat.id),
        name: "title" in chat ? chat.title : "",
    };
}

function projectServiceMembership(
    update: Update,
    message: Message,
    context: TelegramEventProjectorContext,
): CommonEvent.Notice<Update>[] {
    if ("new_chat_members" in message && message.new_chat_members?.length) {
        return message.new_chat_members.map((user, index) =>
            projectNotice(
                update,
                context,
                "member_joined",
                {
                    user: projectUser(user, context),
                    operator: message.from ? projectUser(message.from, context) : undefined,
                    group: projectGroup(message, context),
                    message_id: context.createId(message.message_id),
                    sub_type: "service_message",
                },
                `member-joined:${user.id}:${index}`,
            ),
        );
    }
    if ("left_chat_member" in message && message.left_chat_member) {
        return [
            projectNotice(update, context, "member_left", {
                user: projectUser(message.left_chat_member, context),
                operator: message.from ? projectUser(message.from, context) : undefined,
                group: projectGroup(message, context),
                message_id: context.createId(message.message_id),
                sub_type: "service_message",
            }),
        ];
    }
    return [];
}

function serviceMessageKind(message: Message): string {
    const ignored = new Set([
        "message_id",
        "message_thread_id",
        "from",
        "sender_chat",
        "sender_boost_count",
        "sender_business_bot",
        "date",
        "business_connection_id",
        "chat",
        "forward_origin",
        "is_topic_message",
        "is_automatic_forward",
        "reply_to_message",
        "external_reply",
        "quote",
        "reply_to_story",
        "via_bot",
        "edit_date",
        "has_protected_content",
        "is_from_offline",
        "media_group_id",
        "author_signature",
        "paid_star_count",
        "effect_id",
        "show_caption_above_media",
        "has_media_spoiler",
    ]);
    return Object.keys(message).find(key => !ignored.has(key)) ?? "unsupported_message";
}

function isChatMember(member: { status: string; is_member?: boolean }): boolean {
    if (member.status === "restricted") return member.is_member === true;
    return ["member", "administrator", "creator"].includes(member.status);
}

function projectNotice(
    update: Update,
    context: TelegramEventProjectorContext,
    noticeType: CommonEvent.NoticeType,
    fields: Omit<Partial<CommonEvent.Notice<Update>>, keyof CommonEvent.Base<Update> | "type">,
    eventIdSuffix?: string,
): CommonEvent.Notice<Update> {
    return {
        ...baseEvent(update, context, undefined, eventIdSuffix),
        type: "notice",
        notice_type: noticeType,
        ...fields,
    };
}

function baseEvent(
    update: Update,
    context: TelegramEventProjectorContext,
    unixTimestamp?: number,
    eventIdSuffix?: string,
): CommonEvent.Base<Update> {
    return {
        id: context.createId(
            eventIdSuffix ? `${update.update_id}:${eventIdSuffix}` : update.update_id,
        ),
        timestamp: (unixTimestamp ?? updateTimestamp(update) ?? Date.now() / 1000) * 1000,
        type: "custom",
        platform: "telegram",
        bot_id: context.botId,
        raw_event: update,
    };
}

function updateTimestamp(update: Update): number | undefined {
    const dated =
        update.message ??
        update.edited_message ??
        update.channel_post ??
        update.edited_channel_post ??
        update.business_message ??
        update.edited_business_message ??
        update.message_reaction ??
        update.chat_member ??
        update.my_chat_member ??
        update.chat_join_request ??
        update.business_connection;
    return dated && "date" in dated && typeof dated.date === "number" ? dated.date : undefined;
}
