import { sha256Json, type CommonEvent, type CommonTypes } from "onebots";
import { projectMatrixMessageContent } from "./messages.js";
import type { MatrixEventEnvelope, MatrixRawEvent } from "./types.js";
import { isRecord, optionalString } from "./validation.js";

export interface MatrixProjectionContext {
    botId: CommonTypes.Id;
    botUserId: string;
    createId(value: string | number): CommonTypes.Id;
}

/** Matrix 房间、关系、成员和临时事件的 canonical 投影。 */
export function projectMatrixEvent(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonEvent.Event<MatrixRawEvent>[] {
    const event = envelope.event;
    if (event.type === "m.room.message") return projectRoomMessage(envelope, context);
    if (event.type === "m.sticker") return [projectSticker(envelope, context)];
    if (event.type === "m.reaction") return [projectReaction(envelope, context)];
    if (event.type === "m.room.redaction") return [projectRedaction(envelope, context)];
    if (event.type === "m.room.member") return [projectMembership(envelope, context)];
    if (["m.room.name", "m.room.topic", "m.room.avatar"].includes(event.type)) {
        return [projectRoomUpdate(envelope, context)];
    }
    if (event.type === "m.typing") return projectTyping(envelope, context);
    if (event.type === "m.receipt") return [projectReceipt(envelope, context)];
    if (event.type === "m.presence") return [projectPresence(envelope, context)];
    return [customNotice(envelope, context)];
}

function projectRoomMessage(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonEvent.Event<MatrixRawEvent>[] {
    const event = envelope.event;
    const relation = isRecord(event.content["m.relates_to"])
        ? event.content["m.relates_to"]
        : undefined;
    if (relation?.rel_type === "m.replace") {
        const replacement = isRecord(event.content["m.new_content"])
            ? event.content["m.new_content"]
            : event.content;
        return [
            {
                ...base(envelope, context),
                type: "notice",
                notice_type: "message_updated",
                message_id: context.createId(
                    optionalString(relation.event_id) || event.event_id || eventKey(envelope),
                ),
                user: event.sender ? { id: context.createId(event.sender) } : undefined,
                group: room(envelope, context),
                message: projectMatrixMessageContent(replacement),
                extensions: { matrix: { relation, replacement_event_id: event.event_id } },
            },
        ];
    }
    const roomInfo = room(envelope, context);
    const sender = event.sender || "@unknown:matrix";
    const message = projectMatrixMessageContent(event.content);
    return [
        {
            ...base(envelope, context),
            type: "message",
            message_type: envelope.is_direct ? "direct" : "group",
            sender: { id: context.createId(sender) },
            group: envelope.is_direct ? undefined : roomInfo,
            message_id: context.createId(event.event_id || eventKey(envelope)),
            message,
            raw_message: typeof event.content.body === "string" ? event.content.body : undefined,
            extensions: {
                matrix: {
                    room_id: envelope.room_id,
                    relation,
                    thread_root:
                        relation?.rel_type === "m.thread"
                            ? optionalString(relation.event_id)
                            : undefined,
                },
            },
        },
    ];
}

function projectSticker(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonEvent.Message<MatrixRawEvent> {
    const event = envelope.event;
    return {
        ...base(envelope, context),
        type: "message",
        message_type: envelope.is_direct ? "direct" : "group",
        sender: { id: context.createId(event.sender || "@unknown:matrix") },
        group: envelope.is_direct ? undefined : room(envelope, context),
        message_id: context.createId(event.event_id || eventKey(envelope)),
        message: [
            {
                type: "image",
                data: { file: event.content.url, url: event.content.url, sticker: true },
            },
        ],
        raw_message: optionalString(event.content.body),
    };
}

function projectReaction(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonEvent.Notice<MatrixRawEvent> {
    const relation = isRecord(envelope.event.content["m.relates_to"])
        ? envelope.event.content["m.relates_to"]
        : {};
    return {
        ...base(envelope, context),
        type: "notice",
        notice_type: "reaction_added",
        message_id: context.createId(optionalString(relation.event_id) || eventKey(envelope)),
        user: envelope.event.sender ? { id: context.createId(envelope.event.sender) } : undefined,
        group: room(envelope, context),
        extensions: { matrix: { reaction: optionalString(relation.key), relation } },
    };
}

function projectRedaction(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonEvent.Notice<MatrixRawEvent> {
    return {
        ...base(envelope, context),
        type: "notice",
        notice_type: envelope.redacted_reaction ? "reaction_removed" : "message_deleted",
        message_id: context.createId(
            envelope.redacted_reaction?.event_id || envelope.event.redacts || eventKey(envelope),
        ),
        operator: envelope.event.sender
            ? { id: context.createId(envelope.event.sender) }
            : undefined,
        group: room(envelope, context),
        extensions: {
            matrix: {
                reason: optionalString(envelope.event.content.reason),
                reaction: envelope.redacted_reaction?.key,
                redacted_event_id: envelope.event.redacts,
            },
        },
    };
}

function projectMembership(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonEvent.Event<MatrixRawEvent> {
    const event = envelope.event;
    const membership = optionalString(event.content.membership) || "leave";
    const userId = event.state_key || event.sender || "@unknown:matrix";
    if (membership === "invite" && userId === context.botUserId) {
        return {
            ...base(envelope, context),
            type: "request",
            request_type: "group",
            sub_type: "invitation",
            user: { id: context.createId(event.sender || userId) },
            group: room(envelope, context),
            comment: optionalString(event.content.reason),
            flag: event.event_id || eventKey(envelope),
        };
    }
    return {
        ...base(envelope, context),
        type: "notice",
        notice_type: membership === "join" ? "member_joined" : "member_left",
        sub_type: membership,
        user: {
            id: context.createId(userId),
            name: optionalString(event.content.displayname),
            avatar: optionalString(event.content.avatar_url),
        },
        operator: event.sender ? { id: context.createId(event.sender) } : undefined,
        group: room(envelope, context),
        extensions: { matrix: { membership, reason: optionalString(event.content.reason) } },
    };
}

function projectRoomUpdate(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonEvent.Notice<MatrixRawEvent> {
    return {
        ...base(envelope, context),
        type: "notice",
        notice_type: "channel_updated",
        sub_type: envelope.event.type.slice("m.room.".length),
        group: room(envelope, context),
        extensions: { matrix: envelope.event.content },
    };
}

function projectTyping(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonEvent.Notice<MatrixRawEvent>[] {
    const snapshot = Array.isArray(envelope.event.content.user_ids)
        ? envelope.event.content.user_ids.filter(
              (value): value is string => typeof value === "string",
          )
        : [];
    const delta = envelope.typing_delta || {
        started: snapshot,
        stopped: snapshot.length ? [] : snapshot,
    };
    return [
        typingNotice(envelope, context, "typing_started", delta.started),
        typingNotice(envelope, context, "typing_stopped", delta.stopped),
    ].filter((event): event is CommonEvent.Notice<MatrixRawEvent> => event !== undefined);
}

function typingNotice(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
    noticeType: "typing_started" | "typing_stopped",
    users: readonly string[],
): CommonEvent.Notice<MatrixRawEvent> | undefined {
    if (!users.length) return undefined;
    return {
        ...base(envelope, context),
        type: "notice",
        notice_type: noticeType,
        group: room(envelope, context),
        users: users.map(user => ({ id: context.createId(user) })),
        extensions: { matrix: envelope.event.content },
    };
}

function projectReceipt(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonEvent.Notice<MatrixRawEvent> {
    return {
        ...base(envelope, context),
        type: "notice",
        notice_type: "message_status",
        sub_type: "receipt",
        group: room(envelope, context),
        extensions: { matrix: { receipts: envelope.event.content } },
    };
}

function projectPresence(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonEvent.Notice<MatrixRawEvent> {
    const userId = envelope.event.sender || optionalString(envelope.event.content.user_id);
    return {
        ...base(envelope, context),
        type: "notice",
        notice_type: "user_updated",
        sub_type: "presence",
        user: userId ? { id: context.createId(userId) } : undefined,
        extensions: { matrix: envelope.event.content },
    };
}

function customNotice(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonEvent.Notice<MatrixRawEvent> {
    return {
        ...base(envelope, context),
        type: "notice",
        notice_type: "custom",
        sub_type: envelope.event.type,
        group: room(envelope, context),
        extensions: {
            matrix: {
                section: envelope.section,
                encrypted: envelope.event.type === "m.room.encrypted",
            },
        },
    };
}

function base(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonEvent.Base<MatrixRawEvent> {
    return {
        id: context.createId(`event:${envelope.event.event_id || eventKey(envelope)}`),
        timestamp: envelope.event.origin_server_ts || 0,
        type: "custom",
        platform: "matrix",
        bot_id: context.botId,
        raw_event: envelope.event,
    };
}

function room(
    envelope: MatrixEventEnvelope,
    context: MatrixProjectionContext,
): CommonTypes.Group | undefined {
    return envelope.room_id
        ? { id: context.createId(envelope.room_id), channel_id: context.createId(envelope.room_id) }
        : undefined;
}

function eventKey(envelope: MatrixEventEnvelope): string {
    return sha256Json(envelope);
}
