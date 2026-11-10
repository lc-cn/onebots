import { ImHelper, type EventMap } from "imhelper";
import { createSatoriAdapter, type SatoriAdapterConfig } from "./adapter.js";
import { projectGuildEmojiEvent, type SatoriGuildEmojiNotice } from "./guild-emoji.js";
import type {
    SatoriAdapter,
    SatoriFriend,
    SatoriList,
    SatoriUser,
    SatoriV1Event,
} from "./types.js";

export interface SatoriClientEventMap extends EventMap<string> {
    "guild-emoji": [SatoriGuildEmojiNotice];
}

export class SatoriV1Client extends ImHelper<
    string,
    SatoriV1Event,
    SatoriClientEventMap,
    SatoriAdapter
> {
    constructor(config: SatoriAdapterConfig) {
        super(createSatoriAdapter(config));
        this.adapter.on("event", event => {
            const notice = projectGuildEmojiEvent(event);
            if (notice) this.emit("guild-emoji", notice);
        });
    }

    call<T = unknown>(
        resource: string,
        method: string,
        params?: Record<string, unknown>,
    ): Promise<T> {
        return this.adapter.call<T>(resource, method, params);
    }

    /** 官方 Friend 列表。https://satori.chat/zh-CN/resources/friend.html */
    listFriends(): Promise<SatoriFriend[]> {
        return this.adapter.listFriends();
    }

    /** 删除指定用户的表态。省略 userId 时删除自己的表态。 */
    deleteReaction(
        channelId: string,
        messageId: string,
        emojiId: string,
        userId?: string,
    ): Promise<void> {
        return this.adapter.deleteReaction(channelId, messageId, emojiId, userId);
    }

    /** 清除一条消息上的表态。省略 emojiId 时清除全部表态。 */
    clearReaction(channelId: string, messageId: string, emojiId?: string): Promise<void> {
        return this.adapter.clearReaction(channelId, messageId, emojiId);
    }

    /** 获取给消息添加了指定表态的用户分页。 */
    listReactions(
        channelId: string,
        messageId: string,
        emojiId: string,
        next?: string,
    ): Promise<SatoriList<SatoriUser>> {
        return this.adapter.listReactions(channelId, messageId, emojiId, next);
    }
}

export function createSatoriClient(config: SatoriAdapterConfig): SatoriV1Client {
    return new SatoriV1Client(config);
}
