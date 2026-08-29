import { CommonEvent, type CommonTypes } from "onebots";
import type {
    DiscordApiGuildMember,
    DiscordApiMessage,
    DiscordApiUser,
    DiscordInteraction,
    DiscordMessageDeleteData,
} from "./types.js";

export interface DiscordDispatchEvent {
    name: string;
    data: unknown;
}

interface ProjectorContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

/** 投影 Discord Gateway Dispatch；未标准化事件仍以 custom + raw_event 无损交付。 */
export function projectDiscordDispatch(
    rawEvent: DiscordDispatchEvent,
    context: ProjectorContext,
): CommonEvent.Event<DiscordDispatchEvent> | undefined {
    const { name, data } = rawEvent;
    switch (name) {
        case "MESSAGE_CREATE":
            return projectMessage(data as DiscordApiMessage, rawEvent, context);
        case "MESSAGE_UPDATE": {
            const message = data as DiscordApiMessage;
            return notice(rawEvent, context, "message_updated", {
                message_id: context.createId(message.id),
                message: projectSegments(message),
            });
        }
        case "MESSAGE_DELETE": {
            const message = data as DiscordMessageDeleteData;
            return notice(rawEvent, context, "message_deleted", {
                message_id: context.createId(message.id),
                group: message.guild_id
                    ? { id: context.createId(message.channel_id), name: "" }
                    : undefined,
            });
        }
        case "MESSAGE_REACTION_ADD":
        case "MESSAGE_REACTION_REMOVE": {
            const reaction = data as {
                user_id: string;
                channel_id: string;
                message_id: string;
                guild_id?: string;
                emoji: unknown;
            };
            return notice(
                rawEvent,
                context,
                name === "MESSAGE_REACTION_ADD" ? "reaction_added" : "reaction_removed",
                {
                    user: { id: context.createId(reaction.user_id), name: "" },
                    group: reaction.guild_id
                        ? { id: context.createId(reaction.channel_id), name: "" }
                        : undefined,
                    message_id: context.createId(reaction.message_id),
                    extensions: { discord: { emoji: reaction.emoji } },
                },
            );
        }
        case "GUILD_MEMBER_ADD":
        case "GUILD_MEMBER_REMOVE":
        case "GUILD_MEMBER_UPDATE": {
            const member = data as DiscordApiGuildMember & { guild_id: string };
            return notice(
                rawEvent,
                context,
                name === "GUILD_MEMBER_ADD"
                    ? "member_joined"
                    : name === "GUILD_MEMBER_REMOVE"
                      ? "member_left"
                      : "user_updated",
                {
                    user: member.user ? projectUser(member.user, context) : undefined,
                    group: { id: context.createId(member.guild_id), name: "" },
                },
            );
        }
        case "INTERACTION_CREATE": {
            const interaction = data as DiscordInteraction;
            const user = interaction.user ?? interaction.member?.user;
            return notice(rawEvent, context, "interaction", {
                user: user ? projectUser(user, context) : undefined,
                group: interaction.channel_id
                    ? { id: context.createId(interaction.channel_id), name: "" }
                    : undefined,
                message_id: interaction.message
                    ? context.createId(interaction.message.id)
                    : undefined,
                extensions: {
                    discord: {
                        interaction_id: interaction.id,
                        token: interaction.token,
                        data: interaction.data,
                    },
                },
            });
        }
        case "READY":
        case "RESUMED":
            return undefined;
        default:
            return notice(rawEvent, context, "custom", {
                extensions: { discord: { event_name: name } },
            });
    }
}

function projectMessage(
    message: DiscordApiMessage,
    rawEvent: DiscordDispatchEvent,
    context: ProjectorContext,
): CommonEvent.Message<DiscordDispatchEvent> {
    const isDirect = !message.guild_id;
    return {
        ...base(rawEvent, context, new Date(message.timestamp).getTime()),
        type: "message",
        message_type: isDirect ? "private" : "channel",
        sender: projectUser(message.author, context),
        group: isDirect
            ? undefined
            : {
                  id: context.createId(message.channel_id),
                  name: "",
                  guild_id: context.createId(message.guild_id!),
                  channel_id: context.createId(message.channel_id),
              },
        message: projectSegments(message),
        raw_message: message.content,
        message_id: context.createId(message.id),
    };
}

function projectSegments(message: DiscordApiMessage): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (message.message_reference?.message_id) {
        segments.push({
            type: "reply",
            data: { message_id: message.message_reference.message_id },
        });
    }
    if (message.content) segments.push({ type: "text", data: { text: message.content } });
    for (const attachment of message.attachments ?? []) {
        const type = attachment.content_type?.startsWith("image/")
            ? "image"
            : attachment.content_type?.startsWith("audio/")
              ? "audio"
              : attachment.content_type?.startsWith("video/")
                ? "video"
                : "file";
        segments.push({
            type,
            data: {
                file: attachment.id,
                url: attachment.url,
                filename: attachment.filename,
            },
        });
    }
    for (const sticker of message.sticker_items ?? []) {
        segments.push({ type: "sticker", data: { id: sticker.id, name: sticker.name } });
    }
    return segments;
}

function projectUser(user: DiscordApiUser, context: ProjectorContext): CommonTypes.User {
    return {
        id: context.createId(user.id),
        name: user.global_name ?? user.username,
        avatar: user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : undefined,
    };
}

function notice(
    rawEvent: DiscordDispatchEvent,
    context: ProjectorContext,
    noticeType: CommonEvent.NoticeType,
    fields: Omit<
        Partial<CommonEvent.Notice<DiscordDispatchEvent>>,
        keyof CommonEvent.Base | "type"
    >,
): CommonEvent.Notice<DiscordDispatchEvent> {
    return { ...base(rawEvent, context), type: "notice", notice_type: noticeType, ...fields };
}

function base(
    rawEvent: DiscordDispatchEvent,
    context: ProjectorContext,
    timestamp = Date.now(),
): CommonEvent.Base<DiscordDispatchEvent> {
    return {
        id: context.createId(`${rawEvent.name}:${timestamp}`),
        timestamp,
        type: "custom",
        platform: "discord",
        bot_id: context.botId,
        raw_event: rawEvent,
    };
}
