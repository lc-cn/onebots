interface ZulipActivityBaseEvent {
    id: number;
    type: string;
    [key: string]: unknown;
}

export interface ZulipPresenceValue extends Record<string, unknown> {
    active_timestamp?: number;
    idle_timestamp?: number;
}

export interface ZulipPresenceEvent extends ZulipActivityBaseEvent {
    type: "presence";
    presences?: Record<string, ZulipPresenceValue>;
    user_id?: number;
    server_timestamp?: number;
    presence?: Record<string, unknown>;
}

export interface ZulipUserTopicEvent extends ZulipActivityBaseEvent {
    type: "user_topic";
    stream_id: number;
    topic_name: string;
    last_updated: number;
    visibility_policy: 0 | 1 | 2 | 3;
}

export interface ZulipTypingUser {
    user_id: number;
    email: string;
}

export interface ZulipTypingEvent extends ZulipActivityBaseEvent {
    type: "typing";
    op: "start" | "stop";
    message_type: "direct" | "stream";
    sender: ZulipTypingUser;
    recipients?: ZulipTypingUser[];
    stream_id?: number;
    topic?: string;
}

export type ZulipActivityEvent = ZulipPresenceEvent | ZulipUserTopicEvent | ZulipTypingEvent;
