import { unixSecondsToEventMs, type CommonEvent, type CommonTypes } from "onebots";
import type { MockFriendRequest, MockHeartbeat, MockIncomingMessage } from "./types.js";

export interface MockProjectionContext {
    botId: string;
    createId(value: string | number): CommonTypes.Id;
}

export function projectMockMessage(
    event: MockIncomingMessage,
    context: MockProjectionContext,
): CommonEvent.Message<MockIncomingMessage> {
    return {
        id: context.createId(event.message_id),
        timestamp: unixSecondsToEventMs(event.time),
        platform: "mock",
        bot_id: context.createId(context.botId),
        type: "message",
        message_type: event.type,
        sender: { id: context.createId(event.user_id), name: event.nickname },
        group: event.group_id
            ? { id: context.createId(event.group_id), name: event.group_name }
            : undefined,
        message_id: context.createId(event.message_id),
        raw_message: event.content,
        message: [{ type: "text", data: { text: event.content } }],
        raw_event: event,
    };
}

export function projectMockRequest(
    event: MockFriendRequest,
    context: MockProjectionContext,
): CommonEvent.Request<MockFriendRequest> {
    return {
        id: context.createId(event.flag),
        timestamp: event.time ?? Date.now(),
        platform: "mock",
        bot_id: context.createId(context.botId),
        type: "request",
        request_type: "friend",
        user: { id: context.createId(event.user_id), name: event.nickname },
        comment: event.comment,
        flag: event.flag,
        raw_event: event,
    };
}

export function projectMockHeartbeat(
    event: MockHeartbeat,
    context: MockProjectionContext,
): CommonEvent.Meta<MockHeartbeat> {
    return {
        id: context.createId(`heartbeat:${event.time}`),
        timestamp: event.time,
        platform: "mock",
        bot_id: context.createId(context.botId),
        type: "meta",
        meta_type: "heartbeat",
        raw_event: event,
    };
}
