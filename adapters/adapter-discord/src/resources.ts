import type { DiscordREST } from "./lite/rest.js";
import {
    wrapDiscordMember,
    wrapDiscordMessage,
    type DiscordGuild,
    type DiscordMember,
    type DiscordMessage,
} from "./bot-model.js";
import { DiscordError } from "./errors.js";

/** 完整读取 Bot 所在 Guild，并同步本地缓存。 */
export async function loadDiscordGuilds(
    rest: DiscordREST,
    cache: Map<string, DiscordGuild>,
): Promise<Map<string, DiscordGuild>> {
    const loaded = new Map<string, DiscordGuild>();
    let after: string | undefined;
    for (;;) {
        const page = await rest.getGuilds({ limit: 200, after });
        for (const guild of page) loaded.set(guild.id, guild);
        if (page.length < 200) break;
        after = page.at(-1)?.id;
        if (!after) break;
    }
    cache.clear();
    for (const [id, guild] of loaded) cache.set(id, guild);
    return new Map(cache);
}

/** 按 Discord 单页上限自动翻页读取 Guild 成员。 */
export async function loadDiscordGuildMembers(
    rest: DiscordREST,
    guildId: string,
    limit?: number,
): Promise<Map<string, DiscordMember>> {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
        throw DiscordError.invalid(
            "Discord Guild 成员数量上限必须为正整数",
            "DISCORD_MEMBER_LIMIT_INVALID",
        );
    }
    const members = new Map<string, DiscordMember>();
    let after: string | undefined;
    while (limit === undefined || members.size < limit) {
        const pageLimit = Math.min(1_000, limit === undefined ? 1_000 : limit - members.size);
        const page = await rest.getGuildMembers(guildId, { limit: pageLimit, after });
        for (const member of page) {
            if (member.user) members.set(member.user.id, wrapDiscordMember(member));
        }
        if (page.length < pageLimit) break;
        after = page.at(-1)?.user?.id;
        if (!after) break;
    }
    return members;
}

/** 按 Discord 单页 100 条限制读取指定数量的历史消息。 */
export async function loadDiscordMessages(
    rest: DiscordREST,
    channelId: string,
    limit: number,
    before?: string,
): Promise<Map<string, DiscordMessage>> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw DiscordError.invalid(
            "Discord 历史消息数量必须为正整数",
            "DISCORD_MESSAGE_LIMIT_INVALID",
        );
    }
    const messages = new Map<string, DiscordMessage>();
    let cursor = before;
    while (messages.size < limit) {
        const pageLimit = Math.min(100, limit - messages.size);
        const page = await rest.getMessages(channelId, { limit: pageLimit, before: cursor });
        for (const message of page) messages.set(message.id, wrapDiscordMessage(message));
        if (page.length < pageLimit) break;
        cursor = page.at(-1)?.id;
        if (!cursor) break;
    }
    return messages;
}
