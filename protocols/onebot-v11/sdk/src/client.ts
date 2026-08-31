import { ImHelper, type EventMap } from "imhelper";
import {
    createOnebot11Adapter,
    type OneBotV11Adapter,
    type OneBotV11AdapterConfig,
} from "./adapter.js";
import type { OneBotV11Event, OneBotV11Response } from "./types.js";

export class OneBotV11Client extends ImHelper<
    number,
    OneBotV11Event,
    EventMap<number>,
    OneBotV11Adapter
> {
    constructor(config: OneBotV11AdapterConfig) {
        super(createOnebot11Adapter(config));
    }

    call<T = unknown>(
        action: string,
        params?: Record<string, unknown>,
    ): Promise<OneBotV11Response<T>> {
        return this.adapter.call<T>(action, params);
    }

    inviteFriendToGroup(groupId: number, userId: number): Promise<void> {
        return this.adapter.inviteFriendToGroup(groupId, userId);
    }

    acceptFriendRequest(flag: string, remark?: string): Promise<void> {
        return this.adapter.acceptFriendRequest(flag, remark);
    }
}

export function createOnebot11Client(config: OneBotV11AdapterConfig): OneBotV11Client {
    return new OneBotV11Client(config);
}
