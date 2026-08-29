import type { Message, Update, User } from "grammy/types";
import { CommonEvent, type CommonTypes } from "onebots";

interface TelegramEventProjectorContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

/** 将完整 Telegram Update 投影为 CommonEvent，同时始终保留 raw_event。 */
export function projectTelegramUpdate(
    update: Update,
    context: TelegramEventProjectorContext,
): CommonEvent.Event<Update> | undefined {
    const message = update.message ?? update.channel_post ?? update.business_message ?? undefined;
    if (message) return projectMessage(update, message, context);

    const edited =
        update.edited_message ??
        update.edited_channel_post ??
        update.edited_business_message ??
        undefined;
    if (edited) {
        return projectNotice(update, context, "message_updated", {
            message_id: context.createId(edited.message_id),
            message: projectSegments(edited),
            group: projectGroup(edited, context),
        });
    }

    if (update.callback_query) {
        return projectNotice(update, context, "interaction", {
            user: projectUser(update.callback_query.from, context),
            message_id: update.callback_query.message
                ? context.createId(update.callback_query.message.message_id)
                : undefined,
            extensions: {
                telegram: {
                    callback_query_id: update.callback_query.id,
                    data: update.callback_query.data,
                    chat_instance: update.callback_query.chat_instance,
                },
            },
        });
    }

    if (update.chat_join_request) {
        const request = update.chat_join_request;
        return {
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
        };
    }

    const memberUpdate = update.chat_member ?? update.my_chat_member;
    if (memberUpdate) {
        const previous = memberUpdate.old_chat_member.status;
        const current = memberUpdate.new_chat_member.status;
        const joined = ["member", "administrator", "creator", "restricted"].includes(current);
        const left = ["left", "kicked"].includes(current);
        return projectNotice(
            update,
            context,
            joined && !["member", "administrator", "creator", "restricted"].includes(previous)
                ? "member_joined"
                : left && !["left", "kicked"].includes(previous)
                  ? "member_left"
                  : "custom",
            {
                user: projectUser(memberUpdate.new_chat_member.user, context),
                operator: projectUser(memberUpdate.from, context),
                group: {
                    id: context.createId(memberUpdate.chat.id),
                    name: memberUpdate.chat.title ?? memberUpdate.chat.username ?? "",
                },
                extensions: { telegram: { previous_status: previous, current_status: current } },
            },
        );
    }

    if (update.message_reaction) {
        const reaction = update.message_reaction;
        return projectNotice(update, context, "custom", {
            message_id: context.createId(reaction.message_id),
            user: reaction.user ? projectUser(reaction.user, context) : undefined,
            group: {
                id: context.createId(reaction.chat.id),
                name: reaction.chat.title ?? reaction.chat.username ?? "",
            },
            extensions: {
                telegram: {
                    kind: "message_reaction",
                    old_reaction: reaction.old_reaction,
                    new_reaction: reaction.new_reaction,
                },
            },
        });
    }

    // 其余原生 Update 仍作为 custom notice 无损交付，避免 SDK 升级前丢事件。
    const kind = Object.keys(update).find(key => key !== "update_id");
    if (!kind) return undefined;
    return projectNotice(update, context, "custom", {
        extensions: { telegram: { kind } },
    });
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
        message: projectSegments(message),
        raw_message: message.text ?? message.caption ?? "",
        message_id: context.createId(message.message_id),
    };
}

function projectSegments(message: Message): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (message.text) segments.push({ type: "text", data: { text: message.text } });
    if (message.caption) segments.push({ type: "text", data: { text: message.caption } });
    if (message.photo?.length) {
        segments.push({
            type: "image",
            data: { file: message.photo[message.photo.length - 1]?.file_id },
        });
    }
    if (message.video) segments.push({ type: "video", data: { file: message.video.file_id } });
    if (message.animation) {
        segments.push({
            type: "video",
            data: { file: message.animation.file_id, animation: true },
        });
    }
    if (message.audio) segments.push({ type: "audio", data: { file: message.audio.file_id } });
    if (message.voice)
        segments.push({ type: "audio", data: { file: message.voice.file_id, voice: true } });
    if (message.document) {
        segments.push({
            type: "file",
            data: { file: message.document.file_id, name: message.document.file_name },
        });
    }
    if (message.sticker) {
        segments.push({
            type: "sticker",
            data: { file: message.sticker.file_id, emoji: message.sticker.emoji },
        });
    }
    if (message.location) {
        segments.push({
            type: "location",
            data: { latitude: message.location.latitude, longitude: message.location.longitude },
        });
    }
    if (message.contact) {
        segments.push({
            type: "contact",
            data: {
                phone_number: message.contact.phone_number,
                first_name: message.contact.first_name,
                last_name: message.contact.last_name,
                user_id: message.contact.user_id,
            },
        });
    }
    if (message.reply_to_message) {
        segments.unshift({
            type: "reply",
            data: { message_id: message.reply_to_message.message_id },
        });
    }
    return segments;
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

function projectNotice(
    update: Update,
    context: TelegramEventProjectorContext,
    noticeType: CommonEvent.NoticeType,
    fields: Omit<Partial<CommonEvent.Notice<Update>>, keyof CommonEvent.Base<Update> | "type">,
): CommonEvent.Notice<Update> {
    return { ...baseEvent(update, context), type: "notice", notice_type: noticeType, ...fields };
}

function baseEvent(
    update: Update,
    context: TelegramEventProjectorContext,
    unixTimestamp?: number,
): CommonEvent.Base<Update> {
    return {
        id: context.createId(update.update_id),
        timestamp: unixTimestamp ? unixTimestamp * 1000 : Date.now(),
        type: "custom",
        platform: "telegram",
        bot_id: context.botId,
        raw_event: update,
    };
}
