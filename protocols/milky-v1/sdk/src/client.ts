import { ImHelper, type EventMap } from "imhelper";
import { MilkyV1Adapter, type MilkyAdapterConfig } from "./adapter.js";
import type { MilkyV1Event, MilkyV1Response } from "./types.js";

export class MilkyV1Client extends ImHelper<
    string,
    MilkyV1Event,
    EventMap<string>,
    MilkyV1Adapter
> {
    constructor(config: MilkyAdapterConfig) {
        super(new MilkyV1Adapter(config));
    }

    call<T = unknown>(
        action: string,
        params?: Record<string, unknown>,
    ): Promise<MilkyV1Response<T>> {
        return this.adapter.call<T>(action, params);
    }

    inviteFriendToGroup(groupId: string, userId: string): Promise<void> {
        return this.adapter.inviteFriendToGroup(groupId, userId);
    }

    acceptFriendRequest(initiatorUid: string, isFiltered = false, remark?: string): Promise<void> {
        return this.adapter.acceptFriendRequest(initiatorUid, isFiltered, remark);
    }
}

export function createMilkyClient(config: MilkyAdapterConfig): MilkyV1Client {
    return new MilkyV1Client(config);
}
