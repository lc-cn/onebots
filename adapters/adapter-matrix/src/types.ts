export type MatrixReceiveMode = "sync" | "appservice" | "manual";

/** Matrix 账号配置；全部传输模式共用一个 Client 与事件管线。 */
export interface MatrixConfig {
    account_id: string;
    homeserver_url: string;
    access_token?: string;
    user_id: string;
    device_id?: string;
    receive_mode?: MatrixReceiveMode;
    appservice_id?: string;
    as_token?: string;
    hs_token?: string;
    appservice_path?: string;
    sync_timeout_ms?: number;
    sync_retry_min_ms?: number;
    sync_retry_max_ms?: number;
    initial_sync_limit?: number;
    lazy_load_members?: boolean;
    sync_presence?: "offline" | "online" | "unavailable";
    event_types?: string[];
    direct_room_ids?: string[];
}

export interface MatrixIdentity {
    user_id: string;
    device_id?: string;
    is_guest?: boolean;
}

export interface MatrixRawEvent extends Record<string, unknown> {
    type: string;
    content: Record<string, unknown>;
    event_id?: string;
    room_id?: string;
    sender?: string;
    state_key?: string;
    origin_server_ts?: number;
    unsigned?: Record<string, unknown>;
    redacts?: string;
}

export type MatrixEventSection =
    | "timeline"
    | "state"
    | "ephemeral"
    | "invite_state"
    | "leave"
    | "presence"
    | "to_device"
    | "account_data"
    | "manual"
    | "appservice";

export interface MatrixEventEnvelope {
    event: MatrixRawEvent;
    room_id?: string;
    section: MatrixEventSection;
    is_direct?: boolean;
    transaction_id?: string;
    /** redaction 命中已观察 reaction 时由 Client 补充，避免 projector 猜测目标类型。 */
    redacted_reaction?: { event_id: string; key?: string };
    /** m.typing 是房间快照；Client 计算增量，避免多人输入时漏报单人停止。 */
    typing_delta?: { started: string[]; stopped: string[] };
}

export interface MatrixIngestResult {
    accepted: boolean;
    duplicate: boolean;
    envelope: MatrixEventEnvelope;
}

export interface MatrixTransactionResult {
    transaction_id: string;
    accepted: number;
    duplicate: boolean;
}

export interface MatrixClientEvents {
    event: [envelope: MatrixEventEnvelope];
    ready: [identity: MatrixIdentity];
    error: [error: Error];
    stop: [];
}

export interface MatrixHttpRequest {
    method: string;
    url: string;
    headers?: Readonly<Record<string, string | undefined>>;
    body?: unknown;
}

export interface MatrixHttpResponse {
    status: number;
    headers: Readonly<Record<string, string>>;
    body: Record<string, unknown>;
    transaction?: MatrixTransactionResult;
}

export interface MatrixCallOptions {
    query?: Readonly<Record<string, string | number | boolean | undefined>>;
    body?: unknown;
    token?: "access" | "appservice" | "none";
    signal?: AbortSignal;
}

export interface MatrixSendResponse {
    event_id: string;
}

export interface MatrixRoomSummary {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    canonical_alias?: string;
    joined_member_count?: number;
    invited_member_count?: number;
    room_type?: string;
    encryption?: string;
}

export interface MatrixRoomMember {
    user_id: string;
    membership: "ban" | "invite" | "join" | "knock" | "leave";
    displayname?: string;
    avatar_url?: string;
    is_direct?: boolean;
    reason?: string;
    power_level?: number;
    role?: "owner" | "admin" | "member";
}

export interface MatrixRoomEventPage {
    start: string;
    end?: string;
    chunk: MatrixRawEvent[];
    state?: MatrixRawEvent[];
}

export interface MatrixEventContext {
    event?: MatrixRawEvent;
    events_before: MatrixRawEvent[];
    events_after: MatrixRawEvent[];
    state: MatrixRawEvent[];
    start?: string;
    end?: string;
}

export interface MatrixUploadResponse {
    content_uri: string;
    blurhash?: string;
}

export interface MatrixCreateRoomParams {
    name?: string;
    topic?: string;
    room_alias_name?: string;
    visibility?: "private" | "public";
    preset?: "private_chat" | "public_chat" | "trusted_private_chat";
    invite?: string[];
    is_direct?: boolean;
    room_version?: string;
}

export interface MatrixCreateRoomResponse {
    room_id: string;
}
