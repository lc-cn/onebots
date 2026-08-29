import { CommonEvent, type CommonTypes } from "onebots";
import type {
    DiscordApiGuildMember,
    DiscordApiMessage,
    DiscordApiUser,
    DiscordInteraction,
    DiscordMessageDeleteData,
    DiscordMessageUpdateData,
} from "./types.js";

export interface DiscordDispatchEvent {
    name: string;
    data: unknown;
    /** Gateway sequence；用于生成稳定且跨重连可去重的事件 ID。 */
    sequence?: number | null;
    /** Gateway session；防止全新 Identify 后 sequence 从零开始导致 ID 冲突。 */
    session_id?: string | null;
}

export interface DiscordIdContext {
    createId(value: string | number): CommonTypes.Id;
}

export interface DiscordProjectorContext extends DiscordIdContext {
    botId: CommonTypes.Id;
}

/** 投影 Discord Gateway Dispatch；一个 Dispatch 可以表达多个独立事实。 */
export function projectDiscordEvents(
    rawEvent: DiscordDispatchEvent,
    context: DiscordProjectorContext,
): CommonEvent.Event<DiscordDispatchEvent>[] {
    const { name, data } = rawEvent;
    switch (name) {
        case "MESSAGE_CREATE":
            return [projectMessage(data as DiscordApiMessage, rawEvent, context)];
        case "MESSAGE_UPDATE": {
            const message = data as DiscordMessageUpdateData;
            return [
                notice(rawEvent, context, "message_updated", {
                    message_id: context.createId(message.id),
                    ...(hasMessageProjectionFields(message)
                        ? { message: projectDiscordMessageSegments(message, context) }
                        : {}),
                    group: message.guild_id
                        ? discordChannelGroup(message.channel_id, message.guild_id, context)
                        : undefined,
                }),
            ];
        }
        case "MESSAGE_DELETE": {
            const message = data as DiscordMessageDeleteData;
            return [projectDeletedMessage(message.id, message, rawEvent, context)];
        }
        case "MESSAGE_DELETE_BULK": {
            const deleted = data as DiscordMessageDeleteData & { ids: string[] };
            return deleted.ids.map((messageId, index) =>
                projectDeletedMessage(messageId, deleted, rawEvent, context, `deleted:${index}`),
            );
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
            return [
                notice(
                    rawEvent,
                    context,
                    name === "MESSAGE_REACTION_ADD" ? "reaction_added" : "reaction_removed",
                    {
                        user: { id: context.createId(reaction.user_id), name: "" },
                        group: reaction.guild_id
                            ? discordChannelGroup(reaction.channel_id, reaction.guild_id, context)
                            : undefined,
                        message_id: context.createId(reaction.message_id),
                        extensions: { discord: { emoji: reaction.emoji } },
                    },
                ),
            ];
        }
        case "MESSAGE_REACTION_REMOVE_ALL":
        case "MESSAGE_REACTION_REMOVE_EMOJI": {
            const reaction = data as {
                channel_id: string;
                message_id: string;
                guild_id?: string;
                emoji?: unknown;
            };
            return [
                notice(rawEvent, context, "reaction_removed", {
                    group: reaction.guild_id
                        ? discordChannelGroup(reaction.channel_id, reaction.guild_id, context)
                        : undefined,
                    message_id: context.createId(reaction.message_id),
                    extensions: {
                        discord: {
                            scope: name === "MESSAGE_REACTION_REMOVE_ALL" ? "all" : "emoji",
                            emoji: reaction.emoji,
                        },
                    },
                }),
            ];
        }
        case "GUILD_MEMBER_ADD":
        case "GUILD_MEMBER_REMOVE":
        case "GUILD_MEMBER_UPDATE": {
            const member = data as DiscordApiGuildMember & { guild_id: string };
            return [
                notice(
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
                ),
            ];
        }
        case "INTERACTION_CREATE": {
            const interaction = data as DiscordInteraction;
            const user = interaction.user ?? interaction.member?.user;
            return [
                notice(rawEvent, context, "interaction", {
                    user: user ? projectUser(user, context) : undefined,
                    group: interaction.channel_id
                        ? discordChannelGroup(interaction.channel_id, interaction.guild_id, context)
                        : undefined,
                    message_id: interaction.message
                        ? context.createId(interaction.message.id)
                        : undefined,
                    extensions: {
                        discord: {
                            interaction_id: interaction.id,
                            data: interaction.data,
                        },
                    },
                }),
            ];
        }
        case "READY":
        case "RESUMED":
            return [];
        default:
            return [
                notice(rawEvent, context, "custom", {
                    extensions: { discord: { event_name: name } },
                }),
            ];
    }
}

function projectMessage(
    message: DiscordApiMessage,
    rawEvent: DiscordDispatchEvent,
    context: DiscordProjectorContext,
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
        message: projectDiscordMessageSegments(message, context),
        raw_message: message.content,
        message_id: context.createId(message.id),
    };
}

/** Gateway 事件与查询 API 共用的 Discord 消息段投影。 */
export function projectDiscordMessageSegments(
    message: DiscordMessageUpdateData,
    context: DiscordIdContext,
): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (message.message_reference?.message_id) {
        segments.push({
            type: "reply",
            data: { message_id: context.createId(message.message_reference.message_id) },
        });
    }
    segments.push(...projectContent(message, context));
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
    for (const embed of message.embeds ?? []) {
        segments.push({ type: "embed", data: { embed } });
    }
    return segments;
}

function projectContent(
    message: DiscordMessageUpdateData,
    context: DiscordIdContext,
): CommonTypes.Segment[] {
    if (!message.content) return [];
    const mentions = new Map((message.mentions ?? []).map(user => [user.id, user]));
    const channelMentions = new Map(
        (message.mention_channels ?? []).map(channel => [channel.id, channel]),
    );
    const token = /<@!?(\d+)>|<@&(\d+)>|<#(\d+)>|@(everyone|here)/g;
    const segments: CommonTypes.Segment[] = [];
    let cursor = 0;
    for (const match of message.content.matchAll(token)) {
        const index = match.index ?? cursor;
        if (index > cursor) {
            appendText(segments, message.content.slice(cursor, index));
        }
        if (match[1] && mentions.has(match[1])) {
            segments.push({
                type: "at",
                data: {
                    user_id: context.createId(match[1]),
                    name: mentions.get(match[1])?.global_name ?? mentions.get(match[1])?.username,
                },
            });
        } else if (match[2] && message.mention_roles?.includes(match[2])) {
            segments.push({ type: "at", data: { role_id: context.createId(match[2]) } });
        } else if (match[3]) {
            segments.push({
                type: "channel",
                data: {
                    channel_id: context.createId(match[3]),
                    name: channelMentions.get(match[3])?.name,
                },
            });
        } else if (match[4] && message.mention_everyone) {
            segments.push({ type: "at", data: { user_id: "all", scope: match[4] } });
        } else {
            appendText(segments, match[0]);
        }
        cursor = index + match[0].length;
    }
    if (cursor < message.content.length) {
        appendText(segments, message.content.slice(cursor));
    }
    return segments;
}

function appendText(segments: CommonTypes.Segment[], text: string): void {
    const previous = segments.at(-1);
    if (previous?.type === "text" && typeof previous.data.text === "string") {
        previous.data.text += text;
    } else {
        segments.push({ type: "text", data: { text } });
    }
}

function projectDeletedMessage(
    messageId: string,
    data: DiscordMessageDeleteData,
    rawEvent: DiscordDispatchEvent,
    context: DiscordProjectorContext,
    suffix?: string,
): CommonEvent.Notice<DiscordDispatchEvent> {
    return notice(
        rawEvent,
        context,
        "message_deleted",
        {
            message_id: context.createId(messageId),
            group: data.guild_id
                ? discordChannelGroup(data.channel_id, data.guild_id, context)
                : undefined,
        },
        suffix,
    );
}

function projectUser(user: DiscordApiUser, context: DiscordProjectorContext): CommonTypes.User {
    return {
        id: context.createId(user.id),
        name: user.global_name ?? user.username,
        avatar: user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : undefined,
    };
}

function discordChannelGroup(
    channelId: string,
    guildId: string | undefined,
    context: DiscordIdContext,
): CommonTypes.Group {
    return {
        id: context.createId(channelId),
        name: "",
        guild_id: guildId ? context.createId(guildId) : undefined,
        channel_id: context.createId(channelId),
    };
}

function notice(
    rawEvent: DiscordDispatchEvent,
    context: DiscordProjectorContext,
    noticeType: CommonEvent.NoticeType,
    fields: Omit<
        Partial<CommonEvent.Notice<DiscordDispatchEvent>>,
        keyof CommonEvent.Base | "type"
    >,
    suffix?: string,
): CommonEvent.Notice<DiscordDispatchEvent> {
    return {
        ...base(rawEvent, context, Date.now(), suffix),
        type: "notice",
        notice_type: noticeType,
        ...fields,
    };
}

function base(
    rawEvent: DiscordDispatchEvent,
    context: DiscordProjectorContext,
    timestamp = Date.now(),
    suffix?: string,
): CommonEvent.Base<DiscordDispatchEvent> {
    const identity = rawEvent.sequence ?? eventIdentity(rawEvent.data) ?? timestamp;
    const session = rawEvent.session_id ?? "gateway";
    return {
        id: context.createId(
            `${rawEvent.name}:${session}:${identity}${suffix ? `:${suffix}` : ""}`,
        ),
        timestamp,
        type: "custom",
        platform: "discord",
        bot_id: context.botId,
        raw_event: rawEvent,
    };
}

function eventIdentity(data: unknown): string | undefined {
    if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
    const record = data as Record<string, unknown>;
    for (const key of ["id", "message_id", "guild_id", "channel_id", "user_id"]) {
        const value = record[key];
        if (typeof value === "string" && value) return value;
    }
    return undefined;
}

function hasMessageProjectionFields(message: DiscordMessageUpdateData): boolean {
    return ["content", "attachments", "embeds", "sticker_items", "message_reference"].some(
        field => field in message,
    );
}
