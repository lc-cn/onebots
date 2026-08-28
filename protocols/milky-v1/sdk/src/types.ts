/** Milky V1 客户端类型。 */

export type MilkyMessageScene = "friend" | "group" | "temp";
export type MilkyMessageId = `milky:${MilkyMessageScene}:${number}:${number}`;

export interface MilkySegment {
    type: string;
    data: Record<string, unknown>;
}

export interface MilkyIncomingMessage {
    message_scene: MilkyMessageScene;
    peer_id: number;
    message_seq: number;
    sender_id: number;
    time: number;
    segments: MilkySegment[];
    friend?: { user_id: number; nickname?: string; [key: string]: unknown };
    group?: { group_id: number; group_name?: string; [key: string]: unknown };
    group_member?: { user_id: number; nickname?: string; card?: string; [key: string]: unknown };
    [key: string]: unknown;
}

export interface MilkyMessageRecallData {
    message_scene: MilkyMessageScene;
    peer_id: number;
    message_seq: number;
    sender_id: number;
    operator_id: number;
    display_suffix: string;
}

export interface MilkyV1Event<TData = unknown> {
    event_type: string;
    time: number;
    self_id: number;
    data: TData;
}

export type MilkyMessageReceiveEvent = MilkyV1Event<MilkyIncomingMessage> & {
    event_type: "message_receive";
};

export type MilkyMessageRecallEvent = MilkyV1Event<MilkyMessageRecallData> & {
    event_type: "message_recall";
};

export interface MilkyV1Response<T = unknown> {
    status: "ok" | "failed";
    retcode: number;
    data?: T;
    message?: string;
}

/** OneBots Milky 扩展：邀请好友加入群的参数。 */
export interface MilkyInviteFriendToGroupParams {
    group_id: number;
    user_id: number;
}

export type MilkyCall = (
    action: string,
    params?: Record<string, unknown>,
) => Promise<MilkyV1Response>;

export type MilkyActionUrlResolver = (action: string, apiBaseUrl: string) => string | URL;
