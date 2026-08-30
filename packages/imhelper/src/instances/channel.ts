import { ImHelper } from "../imhelper.js";
import type { Message } from "../message.js";

export class Channel<Id extends string | number = string | number> {
    constructor(
        public helper: ImHelper<Id>,
        public info: Channel.Data<Id>,
    ) {}

    get channel_id() {
        return this.info.channel_id;
    }

    get channel_name() {
        return this.info.channel_name;
    }

    get guild_id() {
        return this.info.guild_id;
    }

    get avatar() {
        return this.info.avatar;
    }

    get members() {
        const members = this.helper.$channelMemberMap.get(this.channel_id);
        return members
            ? Array.from(members.keys(), userId =>
                  this.helper.pickChannelMember(this.channel_id, userId),
              )
            : [];
    }

    setAdmin(userId: Id) {
        return this.helper.adapter.setChannelMemberAdmin(this.channel_id, userId, true);
    }

    setOwner(userId: Id) {
        return this.helper.adapter.setChannelMemberOwner(this.channel_id, userId, true);
    }

    sendMessage(message: Message.Content) {
        return this.helper.adapter.sendMessage({
            scene_type: "channel",
            scene_id: this.channel_id,
            guild_id: this.guild_id,
            message,
        });
    }

    setName(name: string) {
        return this.helper.adapter.setChannelName(this.channel_id, name);
    }

    leave() {
        return this.helper.adapter.leaveChannel(this.channel_id);
    }

    async refresh() {
        await this.helper.getChannelInfo(this.channel_id);
        return this;
    }

    async refreshMembers() {
        return this.helper.getChannelMemberList(this.channel_id);
    }
}

export namespace Channel {
    export interface Data<Id extends string | number = string | number> {
        channel_id: Id;
        guild_id?: Id;
        channel_name?: string;
        avatar?: string;
    }

    export const cache: WeakMap<Data<string | number>, Channel<string | number>> = new WeakMap();

    export function from<Id extends string | number = string | number>(
        this: ImHelper<Id>,
        channelId: Id,
    ): Channel<Id> {
        const data = this.$channelMap.get(channelId);
        if (!data) {
            throw new Error(`Channel ${channelId} not found`);
        }
        if (cache.has(data as Data<string | number>)) {
            return cache.get(data as Data<string | number>) as Channel<Id>;
        }
        const channel = new Channel(this, data);
        cache.set(data as Data<string | number>, channel as Channel<string | number>);
        return channel;
    }
}
