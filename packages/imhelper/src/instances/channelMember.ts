import { ImHelper } from "../imhelper.js";
import { User } from "./user.js";

// @ts-expect-error - 静态 from 需要额外的 channelId，这是派生实体的有意差异。
export class ChannelMember<Id extends string | number = string | number> extends User<Id> {
    constructor(
        public helper: ImHelper<Id>,
        public info: ChannelMember.Data<Id>,
    ) {
        super(helper, info);
    }

    get channel_id() {
        return this.info.channel_id;
    }

    get channel() {
        return this.helper.pickChannel(this.channel_id);
    }

    get role() {
        return this.info.role;
    }

    setAdmin() {
        return this.helper.adapter.setChannelMemberAdmin(this.channel_id, this.user_id, true);
    }

    setOwner() {
        return this.helper.adapter.setChannelMemberOwner(this.channel_id, this.user_id, true);
    }

    unsetAdmin() {
        return this.helper.adapter.unsetChannelMemberAdmin(this.channel_id, this.user_id);
    }

    unsetOwner() {
        return this.helper.adapter.unsetChannelMemberOwner(this.channel_id, this.user_id);
    }

    async refresh() {
        await this.helper.getChannelMemberInfo(this.channel_id, this.user_id);
        return this;
    }
}

export namespace ChannelMember {
    export interface Data<Id extends string | number = string | number> extends User.Data<Id> {
        channel_id: Id;
        role?: "owner" | "admin" | "member";
    }

    export const cache: WeakMap<
        Data<string | number>,
        ChannelMember<string | number>
    > = new WeakMap();

    export function from<Id extends string | number = string | number>(
        this: ImHelper<Id>,
        channelId: Id,
        userId: Id,
    ): ChannelMember<Id> {
        const data = this.$channelMemberMap.get(channelId)?.get(userId);
        if (!data) {
            throw new Error(`member ${userId} of channel ${channelId} not found`);
        }
        if (cache.has(data as Data<string | number>)) {
            return cache.get(data as Data<string | number>) as ChannelMember<Id>;
        }
        const member = new ChannelMember(this, data);
        cache.set(data as Data<string | number>, member as ChannelMember<string | number>);
        return member;
    }
}
