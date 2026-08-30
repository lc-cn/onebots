import type { ImHelper } from "./imhelper.js";
import type { Friend } from "./instances/friend.js";
import type { GroupMember } from "./instances/groupMember.js";
import type { ChannelMember } from "./instances/channelMember.js";

type EntityId = string | number;
type EventRecord = Record<string, unknown>;

function isEntityId(value: unknown): value is EntityId {
    return typeof value === "string" || typeof value === "number";
}

function upsert<Key, Value extends object>(target: Map<Key, Value>, key: Key, value: Value): void {
    const current = target.get(key);
    if (current) Object.assign(current, value);
    else target.set(key, value);
}

function observeUser<Id extends EntityId>(helper: ImHelper<Id>, userId: Id): void {
    upsert(helper.$userMap, userId, { user_id: userId });
}

function observeGroup<Id extends EntityId>(helper: ImHelper<Id>, groupId: Id): void {
    upsert(helper.$groupMap, groupId, { group_id: groupId });
}

function observeChannel<Id extends EntityId>(
    helper: ImHelper<Id>,
    channelId: Id,
    guildId?: Id,
): void {
    upsert(helper.$channelMap, channelId, {
        channel_id: channelId,
        ...(guildId === undefined ? {} : { guild_id: guildId }),
    });
}

function observeGroupMember<Id extends EntityId>(
    helper: ImHelper<Id>,
    groupId: Id,
    userId: Id,
): void {
    const members = helper.$groupMemberMap.get(groupId) ?? new Map<Id, GroupMember.Data<Id>>();
    helper.$groupMemberMap.set(groupId, members);
    upsert(members, userId, { group_id: groupId, user_id: userId });
}

function observeChannelMember<Id extends EntityId>(
    helper: ImHelper<Id>,
    channelId: Id,
    userId: Id,
): void {
    const members =
        helper.$channelMemberMap.get(channelId) ?? new Map<Id, ChannelMember.Data<Id>>();
    helper.$channelMemberMap.set(channelId, members);
    upsert(members, userId, { channel_id: channelId, user_id: userId });
}

/**
 * 将事件已经证明存在的实体写入 identity map。
 *
 * 这里只记录稳定 ID，不猜测展示资料，也不把申请人提前标记为好友或成员。后续目录查询会
 * 在相同对象上补全资料，从而保持事件 getter 返回的实体引用稳定。
 */
export function observeEventEntities<Id extends EntityId>(
    helper: ImHelper<Id>,
    eventType: string,
    data: EventRecord,
): void {
    const userId = isEntityId(data.user_id) ? (data.user_id as Id) : undefined;
    const operatorId = isEntityId(data.operator_id) ? (data.operator_id as Id) : undefined;
    const groupId = isEntityId(data.group_id) ? (data.group_id as Id) : undefined;
    const channelId = isEntityId(data.channel_id) ? (data.channel_id as Id) : undefined;
    const guildId = isEntityId(data.guild_id) ? (data.guild_id as Id) : undefined;

    if (userId !== undefined) observeUser(helper, userId);
    if (operatorId !== undefined) observeUser(helper, operatorId);
    if (groupId !== undefined) observeGroup(helper, groupId);
    if (channelId !== undefined) observeChannel(helper, channelId, guildId);

    if (
        groupId !== undefined &&
        userId !== undefined &&
        (eventType === "message.group" || eventType.startsWith("notice.group_member_"))
    ) {
        observeGroupMember(helper, groupId, userId);
    }

    if (channelId !== undefined && userId !== undefined && eventType === "message.channel") {
        observeChannelMember(helper, channelId, userId);
    }

    if (userId !== undefined && eventType === "notice.friend_increase") {
        upsert(helper.$friendMap, userId, { user_id: userId } satisfies Friend.Data<Id>);
    }
}
