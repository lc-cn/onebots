import { MatrixError } from "./errors.js";
import type { MatrixRawEvent, MatrixRoomMember, MatrixRoomSummary } from "./types.js";
import { isRecord, optionalString, parseMatrixEvent, requireString } from "./validation.js";

export function parseJoinedRooms(value: unknown): string[] {
    if (!isRecord(value) || !Array.isArray(value.joined_rooms)) {
        throw MatrixError.invalid("joined_rooms 响应缺少数组");
    }
    return value.joined_rooms.map((room, index) => requireString(room, `joined_rooms[${index}]`));
}

export function parseRoomSummary(value: unknown, roomId: string): MatrixRoomSummary {
    if (!isRecord(value)) throw MatrixError.invalid("room_summary 响应必须是对象");
    return {
        room_id: optionalString(value.room_id) || roomId,
        name: optionalString(value.name),
        topic: optionalString(value.topic),
        avatar_url: optionalString(value.avatar_url),
        canonical_alias: optionalString(value.canonical_alias),
        joined_member_count: optionalNumber(value.num_joined_members),
        invited_member_count: optionalNumber(value.num_invited_members),
        room_type: optionalString(value.room_type),
        encryption: optionalString(value.encryption),
    };
}

export function parseRoomState(value: unknown): MatrixRawEvent[] {
    if (!Array.isArray(value)) throw MatrixError.invalid("Matrix room state 必须是数组");
    return value.map(parseMatrixEvent);
}

export function parseMembers(value: unknown): MatrixRoomMember[] {
    if (!isRecord(value) || !Array.isArray(value.chunk)) {
        throw MatrixError.invalid("Matrix members 响应缺少 chunk 数组");
    }
    return value.chunk.map(raw => {
        const event = parseMatrixEvent(raw);
        if (event.type !== "m.room.member" || !event.state_key) {
            throw MatrixError.invalid("Matrix members chunk 包含非成员状态事件");
        }
        const membership = optionalString(event.content.membership);
        if (!isMembership(membership)) throw MatrixError.invalid("Matrix member membership 无效");
        return {
            user_id: event.state_key,
            membership,
            displayname: optionalString(event.content.displayname),
            avatar_url: optionalString(event.content.avatar_url),
            is_direct: event.content.is_direct === true,
            reason: optionalString(event.content.reason),
        };
    });
}

export function applyPowerLevels(
    members: readonly MatrixRoomMember[],
    state: readonly MatrixRawEvent[],
): MatrixRoomMember[] {
    const powerEvent = state.find(
        event => event.type === "m.room.power_levels" && event.state_key === "",
    );
    const users = isRecord(powerEvent?.content.users) ? powerEvent.content.users : {};
    const defaultLevel = optionalNumber(powerEvent?.content.users_default) || 0;
    return members.map(member => {
        const configured = users[member.user_id];
        const powerLevel = typeof configured === "number" ? configured : defaultLevel;
        return {
            ...member,
            power_level: powerLevel,
            role: powerLevel >= 100 ? "owner" : powerLevel >= 50 ? "admin" : "member",
        };
    });
}

export function parseProfile(
    value: unknown,
    userId: string,
): {
    user_id: string;
    displayname?: string;
    avatar_url?: string;
} {
    if (!isRecord(value)) throw MatrixError.invalid("Matrix profile 响应必须是对象");
    return {
        user_id: userId,
        displayname: optionalString(value.displayname),
        avatar_url: optionalString(value.avatar_url),
    };
}

export function findRoomName(state: readonly MatrixRawEvent[], roomId: string): string {
    const name = state.find(event => event.type === "m.room.name" && event.state_key === "");
    const canonicalAlias = state.find(
        event => event.type === "m.room.canonical_alias" && event.state_key === "",
    );
    return (
        optionalString(name?.content.name) ||
        optionalString(canonicalAlias?.content.alias) ||
        roomId
    );
}

export function findRoomTopic(state: readonly MatrixRawEvent[]): string | undefined {
    return optionalString(
        state.find(event => event.type === "m.room.topic" && event.state_key === "")?.content.topic,
    );
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isMembership(value: string | undefined): value is MatrixRoomMember["membership"] {
    return value !== undefined && ["ban", "invite", "join", "knock", "leave"].includes(value);
}
