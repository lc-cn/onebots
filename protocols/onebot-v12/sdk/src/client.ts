import { ImHelper, type EventMap } from "imhelper";
import {
    createOnebot12Adapter,
    type OneBotV12Adapter,
    type OneBotV12AdapterConfig,
} from "./adapter.js";
import type { OneBotV12Event, OneBotV12Response } from "./types.js";

export class OneBotV12Client extends ImHelper<
    string,
    OneBotV12Event,
    EventMap<string>,
    OneBotV12Adapter
> {
    constructor(config: OneBotV12AdapterConfig) {
        super(createOnebot12Adapter(config));
    }

    call<T = unknown>(
        action: string,
        params?: Record<string, unknown>,
    ): Promise<OneBotV12Response<T>> {
        return this.adapter.call<T>(action, params);
    }

    inviteFriendToGroup(groupId: string, userId: string): Promise<void> {
        return this.adapter.inviteFriendToGroup(groupId, userId);
    }

    acceptFriendRequest(flag: string, remark?: string): Promise<void> {
        return this.adapter.acceptFriendRequest(flag, remark);
    }
}

export function createOnebot12Client(config: OneBotV12AdapterConfig): OneBotV12Client {
    return new OneBotV12Client(config);
}
