import type {
    DiscordApiAttachment,
    DiscordApiChannel,
    DiscordApiGuild,
    DiscordApiGuildMember,
    DiscordApiMessage,
    DiscordApiUser,
} from "./types.js";

export interface DiscordUser extends DiscordApiUser {
    displayAvatarURL(): string;
    tag: string;
}

export interface DiscordMessage extends Omit<DiscordApiMessage, "author"> {
    createdTimestamp: number;
    channel: { id: string; type: number };
    guild?: { id: string; name?: string };
    author: DiscordUser;
}

export type DiscordAttachment = DiscordApiAttachment;
export type DiscordGuild = DiscordApiGuild;
export type DiscordChannel = DiscordApiChannel;
/**
 * 经 Bot 边界校验后的成员。
 * Discord 的通用负载将 user 标为可选，但 REST 与成员网关事件必须携带用户。
 */
export type DiscordMember = Omit<DiscordApiGuildMember, "user"> & { user: DiscordUser };

export function wrapDiscordUser(user: DiscordApiUser): DiscordUser {
    return {
        ...user,
        displayAvatarURL: () => {
            if (user.avatar) {
                return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
            }
            const defaultAvatar = Number.parseInt(user.discriminator || "0", 10) % 5;
            return `https://cdn.discordapp.com/embed/avatars/${defaultAvatar}.png`;
        },
        tag: `${user.username}#${user.discriminator || "0"}`,
    };
}

export function wrapDiscordMember(member: DiscordApiGuildMember): DiscordMember {
    if (!member.user) {
        throw new Error("Discord 成员负载缺少 user");
    }
    return {
        ...member,
        user: wrapDiscordUser(member.user),
    };
}

export function wrapDiscordMessage(message: DiscordApiMessage): DiscordMessage {
    return {
        ...message,
        createdTimestamp: new Date(message.timestamp).getTime(),
        channel: { id: message.channel_id, type: message.guild_id ? 0 : 1 },
        guild: message.guild_id ? { id: message.guild_id } : undefined,
        author: wrapDiscordUser(message.author),
    };
}
