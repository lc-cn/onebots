import { MatrixError } from "./errors.js";
import type { MatrixEventEnvelope, MatrixRawEvent } from "./types.js";
import { isRecord, parseMatrixEvent, requireString } from "./validation.js";

export interface MatrixSyncBatch {
    nextBatch: string;
    envelopes: MatrixEventEnvelope[];
    directRooms: Set<string>;
}

/** 严格展开 /sync 的各个事件区，避免只投影 timeline 而静默丢失状态事件。 */
export function parseMatrixSync(
    value: unknown,
    knownDirectRooms: ReadonlySet<string>,
): MatrixSyncBatch {
    if (!isRecord(value)) throw MatrixError.invalid("Matrix /sync 响应必须是对象");
    const directRooms = new Set(knownDirectRooms);
    const envelopes: MatrixEventEnvelope[] = [];
    collectGlobal(value.account_data, "account_data", envelopes, directRooms);
    collectGlobal(value.presence, "presence", envelopes, directRooms);
    collectGlobal(value.to_device, "to_device", envelopes, directRooms);
    if (value.rooms !== undefined && !isRecord(value.rooms)) {
        throw MatrixError.invalid("Matrix /sync rooms 必须是对象");
    }
    const rooms = isRecord(value.rooms) ? value.rooms : {};
    collectRoomMap(rooms.join, "timeline", envelopes, directRooms);
    collectInviteMap(rooms.invite, envelopes, directRooms);
    collectLeaveMap(rooms.leave, envelopes, directRooms);
    return {
        nextBatch: requireString(value.next_batch, "sync.next_batch"),
        envelopes,
        directRooms,
    };
}

function collectGlobal(
    section: unknown,
    name: MatrixEventEnvelope["section"],
    target: MatrixEventEnvelope[],
    directRooms: Set<string>,
): void {
    if (section === undefined) return;
    if (!isRecord(section) || !Array.isArray(section.events)) {
        throw MatrixError.invalid(`Matrix /sync ${name} 必须包含 events 数组`);
    }
    for (const raw of section.events) {
        const event = parseMatrixEvent(raw);
        if (event.type === "m.direct") captureDirectRooms(event, directRooms);
        target.push({ event, room_id: event.room_id, section: name });
    }
}

function collectRoomMap(
    value: unknown,
    timelineName: MatrixEventEnvelope["section"],
    target: MatrixEventEnvelope[],
    directRooms: ReadonlySet<string>,
): void {
    if (value === undefined) return;
    if (!isRecord(value)) throw MatrixError.invalid("Matrix /sync rooms.join 必须是对象");
    for (const [roomId, rawRoom] of Object.entries(value)) {
        if (!isRecord(rawRoom))
            throw MatrixError.invalid(`Matrix /sync join room ${roomId} 必须是对象`);
        collectRoomSection(rawRoom.state, roomId, "state", target, directRooms);
        collectRoomSection(rawRoom.timeline, roomId, timelineName, target, directRooms);
        collectRoomSection(rawRoom.ephemeral, roomId, "ephemeral", target, directRooms);
        collectRoomSection(rawRoom.account_data, roomId, "account_data", target, directRooms);
    }
}

function collectInviteMap(
    value: unknown,
    target: MatrixEventEnvelope[],
    directRooms: ReadonlySet<string>,
): void {
    if (value === undefined) return;
    if (!isRecord(value)) throw MatrixError.invalid("Matrix /sync rooms.invite 必须是对象");
    for (const [roomId, rawRoom] of Object.entries(value)) {
        if (!isRecord(rawRoom))
            throw MatrixError.invalid(`Matrix /sync invite room ${roomId} 必须是对象`);
        collectRoomSection(rawRoom.invite_state, roomId, "invite_state", target, directRooms);
    }
}

function collectLeaveMap(
    value: unknown,
    target: MatrixEventEnvelope[],
    directRooms: ReadonlySet<string>,
): void {
    if (value === undefined) return;
    if (!isRecord(value)) throw MatrixError.invalid("Matrix /sync rooms.leave 必须是对象");
    for (const [roomId, rawRoom] of Object.entries(value)) {
        if (!isRecord(rawRoom))
            throw MatrixError.invalid(`Matrix /sync leave room ${roomId} 必须是对象`);
        collectRoomSection(rawRoom.state, roomId, "leave", target, directRooms);
        collectRoomSection(rawRoom.timeline, roomId, "leave", target, directRooms);
        collectRoomSection(rawRoom.account_data, roomId, "account_data", target, directRooms);
    }
}

function collectRoomSection(
    section: unknown,
    roomId: string,
    name: MatrixEventEnvelope["section"],
    target: MatrixEventEnvelope[],
    directRooms: ReadonlySet<string>,
): void {
    if (section === undefined) return;
    if (!isRecord(section) || !Array.isArray(section.events)) {
        throw MatrixError.invalid(`Matrix /sync room ${roomId} ${name} 必须包含 events 数组`);
    }
    for (const raw of section.events) {
        const event = parseMatrixEvent(raw);
        target.push({
            event,
            room_id: roomId,
            section: name,
            is_direct: directRooms.has(roomId),
        });
    }
}

function captureDirectRooms(event: MatrixRawEvent, target: Set<string>): void {
    // m.direct 是完整账号数据快照，不是增量；先清空才能正确处理会话解除。
    target.clear();
    for (const rooms of Object.values(event.content)) {
        if (!Array.isArray(rooms)) continue;
        for (const room of rooms) if (typeof room === "string") target.add(room);
    }
}
