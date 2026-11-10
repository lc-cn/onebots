import type { SatoriSdkCaller } from "./directory-api.js";
import { parseSatoriUserList } from "./protocol-data.js";
import type { SatoriList, SatoriUser } from "./types.js";

/** https://satori.chat/zh-CN/resources/reaction.html */
export class SatoriReactionApi {
    constructor(private readonly call: SatoriSdkCaller) {}

    create(channelId: string, messageId: string, emojiId: string): Promise<unknown> {
        return this.call("reaction.create", {
            channel_id: channelId,
            message_id: messageId,
            emoji_id: emojiId,
        });
    }

    delete(
        channelId: string,
        messageId: string,
        emojiId: string,
        userId?: string,
    ): Promise<unknown> {
        return this.call("reaction.delete", {
            channel_id: channelId,
            message_id: messageId,
            emoji_id: emojiId,
            ...(userId !== undefined ? { user_id: userId } : {}),
        });
    }

    clear(channelId: string, messageId: string, emojiId?: string): Promise<unknown> {
        return this.call("reaction.clear", {
            channel_id: channelId,
            message_id: messageId,
            ...(emojiId !== undefined ? { emoji_id: emojiId } : {}),
        });
    }

    async list(
        channelId: string,
        messageId: string,
        emojiId: string,
        next?: string,
    ): Promise<SatoriList<SatoriUser>> {
        const response = await this.call("reaction.list", {
            channel_id: channelId,
            message_id: messageId,
            emoji_id: emojiId,
            ...(next !== undefined ? { next } : {}),
        });
        return parseSatoriUserList(response, "reaction.list");
    }
}
