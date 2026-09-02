export type MattermostReceiveMode = "websocket" | "manual";
export type MattermostHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type MattermostChannelType = "O" | "P" | "D" | "G";

/** Mattermost 账号配置；主动与外部 WebSocket 共用同一个 Client 和事件入口。 */
export interface MattermostConfig {
    account_id: string;
    server_url: string;
    access_token: string;
    receive_mode?: MattermostReceiveMode;
    event_types?: string[];
    team_ids?: string[];
    channel_ids?: string[];
    reconnect_initial_delay_ms?: number;
    reconnect_max_delay_ms?: number;
    connect_timeout_ms?: number;
    max_response_bytes?: number;
}

export interface MattermostUser {
    id: string;
    create_at: number;
    update_at: number;
    delete_at: number;
    username: string;
    first_name?: string;
    last_name?: string;
    nickname?: string;
    email?: string;
    email_verified?: boolean;
    auth_service?: string;
    roles?: string;
    locale?: string;
    position?: string;
    props?: Record<string, unknown>;
    notify_props?: Record<string, unknown>;
    timezone?: Record<string, unknown>;
    is_bot?: boolean;
}

export interface MattermostTeam {
    id: string;
    create_at: number;
    update_at: number;
    delete_at: number;
    display_name: string;
    name: string;
    description?: string;
    email?: string;
    type: "O" | "I";
    company_name?: string;
    allowed_domains?: string;
    invite_id?: string;
    scheme_id?: string;
}

export interface MattermostChannel {
    id: string;
    create_at: number;
    update_at: number;
    delete_at: number;
    team_id: string;
    type: MattermostChannelType;
    display_name: string;
    name: string;
    header?: string;
    purpose?: string;
    last_post_at?: number;
    total_msg_count?: number;
    creator_id?: string;
    scheme_id?: string;
    group_constrained?: boolean;
    shared?: boolean;
}

export interface MattermostPostMetadata {
    emojis?: unknown[];
    files?: MattermostFileInfo[];
    embeds?: unknown[];
    images?: Record<string, unknown>;
    reactions?: MattermostReaction[];
    priority?: { priority?: string; requested_ack?: boolean };
    [key: string]: unknown;
}

export interface MattermostPost {
    id: string;
    create_at: number;
    update_at: number;
    edit_at: number;
    delete_at: number;
    is_pinned: boolean;
    user_id: string;
    channel_id: string;
    root_id: string;
    original_id: string;
    message: string;
    type: string;
    props: Record<string, unknown>;
    hashtags: string;
    file_ids: string[];
    pending_post_id: string;
    reply_count?: number;
    last_reply_at?: number;
    participants?: string[];
    metadata?: MattermostPostMetadata;
}

export interface MattermostPostList {
    order: string[];
    posts: Record<string, MattermostPost>;
    next_post_id?: string;
    prev_post_id?: string;
}

export interface MattermostReaction {
    user_id: string;
    post_id: string;
    emoji_name: string;
    create_at: number;
}

export interface MattermostFileInfo {
    id: string;
    user_id: string;
    post_id: string;
    channel_id: string;
    create_at: number;
    update_at: number;
    delete_at: number;
    name: string;
    extension?: string;
    size: number;
    mime_type: string;
    width?: number;
    height?: number;
    has_preview_image?: boolean;
    mini_preview?: string;
}

export interface MattermostStatus {
    user_id: string;
    status: "online" | "away" | "dnd" | "offline";
    manual?: boolean;
    last_activity_at?: number;
}

export interface MattermostTeamMember {
    team_id: string;
    user_id: string;
    roles: string;
    delete_at: number;
    scheme_user: boolean;
    scheme_admin: boolean;
    scheme_guest: boolean;
}

export interface MattermostChannelMember {
    channel_id: string;
    user_id: string;
    roles: string;
    last_viewed_at: number;
    msg_count: number;
    mention_count: number;
    mention_count_root?: number;
    notify_props?: Record<string, unknown>;
    last_update_at?: number;
    scheme_user: boolean;
    scheme_admin: boolean;
    scheme_guest: boolean;
}

export interface MattermostWebSocketBroadcast {
    omit_users?: string[] | null;
    user_id?: string;
    channel_id?: string;
    team_id?: string;
    connection_id?: string;
    omit_connection_id?: string;
}

/** 官方 WebSocket event envelope；data 中的平台字段保持原样。 */
export interface MattermostWebSocketEvent {
    event: string;
    data: Record<string, unknown>;
    broadcast: MattermostWebSocketBroadcast;
    seq: number;
}

export interface MattermostWebSocketResponse {
    status: "OK" | "FAIL";
    seq_reply: number;
    data?: Record<string, unknown>;
    error?: { id: string; message: string; detailed_error?: string; request_id?: string };
}

export interface MattermostDelivery {
    event: MattermostWebSocketEvent;
    post?: MattermostPost;
    reaction?: MattermostReaction;
    user?: MattermostUser;
    channel?: MattermostChannel;
    team?: MattermostTeam;
}

export interface MattermostIngestResult {
    accepted: boolean;
    duplicate: boolean;
    filtered: boolean;
    delivery: MattermostDelivery;
}

export interface MattermostCallOptions {
    query?: Readonly<Record<string, string | number | boolean | undefined>>;
    body?: unknown;
    form?: FormData;
    signal?: AbortSignal;
    headers?: Readonly<Record<string, string>>;
}

export interface MattermostSocketAttachOptions {
    /** 已由外部 Host 通过 Authorization header 完成认证时可关闭 challenge。 */
    authenticate?: boolean;
    /** 连接所有权为 false 时 stop() 只解绑监听器，不关闭外部 socket。 */
    owned?: boolean;
}

export interface MattermostClientEvents {
    ready: [user: MattermostUser];
    connected: [event: MattermostWebSocketEvent];
    disconnected: [error?: Error];
    missed: [expected: number, actual: number, event: MattermostWebSocketEvent];
    event: [delivery: MattermostDelivery];
    error: [error: Error];
    stop: [];
}

export interface MattermostUploadResult {
    file_infos: MattermostFileInfo[];
    client_ids?: string[];
}

export interface MattermostCreatePost {
    channel_id: string;
    message: string;
    root_id?: string;
    file_ids?: string[];
    props?: Record<string, unknown>;
    metadata?: MattermostPostMetadata;
}
