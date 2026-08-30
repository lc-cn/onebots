/** 黑盒语音开放平台配置。 */
export interface ProxyConfig {
    url: string;
    username?: string;
    password?: string;
}

export interface HeychatConfig {
    account_id: string;
    token: string;
    /** manual 不创建正向连接，由宿主调用 ingest() 或 acceptWebSocket() */
    receive_mode?: "websocket" | "manual";
    api_base_url?: string;
    upload_base_url?: string;
    ws_url?: string;
    chat_version?: string;
    voice_api_type?: "trtc" | "volc";
    heartbeat_interval_ms?: number;
    reconnect_initial_delay_ms?: number;
    reconnect_max_delay_ms?: number;
    request_timeout_ms?: number;
    proxy?: ProxyConfig;
    /** 用户 OAuth 应用凭据；仅在调用 OAuth 扩展动作时需要。 */
    oauth?: HeychatOAuthConfig;
}

export type HeychatOAuthConfig = HeychatOAuthDisabledConfig | HeychatOAuthEnabledConfig;

export interface HeychatOAuthDisabledConfig {
    enabled: false;
}

export interface HeychatOAuthEnabledConfig {
    /** 手写配置省略时视为启用。 */
    enabled?: true;
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    /** 授权页与令牌端点，默认使用 chat.xiaoheihe.cn。 */
    api_base_url?: string;
    /** 用户资料与时长端点，默认使用 api.xiaoheihe.cn。 */
    resource_base_url?: string;
}

export interface HeychatOAuthToken {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
    token_type: "Bearer";
}

export interface HeychatOAuthUserInfo {
    avatar: string;
    username: string;
}

export interface HeychatVoiceDuration {
    room_id: string | number;
    user_id: number;
    create_at: string;
    update_at?: string;
    duration: number;
}

export interface HeychatVoiceDurationResult {
    durations: HeychatVoiceDuration[];
}

export interface HeychatVoiceDurationQuery {
    room_id?: string;
    begin_time?: number;
    end_time?: number;
    appid?: string;
}

export interface HeychatRoomBaseInfo {
    room_id: string;
    room_name?: string;
    room_avatar?: string;
}

export interface HeychatChannelBaseInfo {
    channel_id: string;
    channel_name?: string;
    channel_type?: number;
}

export interface HeychatUserInfo {
    user_id: number;
    username?: string;
    nickname?: string;
    avatar?: string;
    bot?: boolean;
    level?: number;
    room_nickname?: string;
    joined_at?: number;
    roles?: string[] | null;
    online_state?: number;
}

export interface HeychatCommandOption {
    name: string;
    type: number;
    value?: string;
    choices?: HeychatCommandOption[];
}

export interface HeychatCommandInfo {
    id: string;
    name: string;
    type?: number;
    options?: HeychatCommandOption[];
}

export interface HeychatUseCommandData {
    bot_id?: number;
    room_base_info?: HeychatRoomBaseInfo;
    channel_base_info?: HeychatChannelBaseInfo;
    command_info?: HeychatCommandInfo;
    msg_id?: string;
    send_time?: number;
    sender_info?: HeychatUserInfo;
}

export interface HeychatReactionData {
    channel_id?: string;
    emoji?: string;
    is_add?: number;
    msg_id?: string;
    user_id?: number;
}

export interface HeychatRoomMemberData {
    room_base_info?: HeychatRoomBaseInfo;
    state?: number;
    user_info?: HeychatUserInfo;
}

export interface HeychatCardClickData {
    room_base_info?: HeychatRoomBaseInfo;
    channel_base_info?: HeychatChannelBaseInfo;
    sender_info?: HeychatUserInfo;
    user_info?: HeychatUserInfo;
    msg_id?: string;
    [key: string]: unknown;
}

export interface HeychatWsEnvelope<
    TData extends Record<string, unknown> = Record<string, unknown>,
> {
    sequence: number;
    type: string;
    data: TData;
    timestamp: number;
    notify_type?: string;
}

export interface HeychatChannelContext {
    room_id: string;
    channel_id: string;
    channel_type?: number;
    room_name?: string;
    channel_name?: string;
}

export interface HeychatImageInfo {
    url: string;
    width?: number;
    height?: number;
}

export interface HeychatOutboundMessage {
    msg?: string;
    img?: string;
    msg_type: 3 | 4 | 10 | 20;
    addition: string;
    reply_id?: string;
    at_user_id?: string;
    at_role_id?: string;
    mention_channel_id?: string;
    [key: string]: unknown;
}

export interface HeychatSendMessageResult {
    msg_id: string;
    heychat_ack_id: string;
}

export interface HeychatRoomInfo {
    room_id: string;
    room_name?: string;
    room_avatar?: string;
    member_count?: number;
    user_count?: number;
    [key: string]: unknown;
}

export interface HeychatChannelInfo {
    channel_id: string;
    channel_name?: string;
    channel_type?: number;
    parent_id?: string;
    api_type?: string;
    channel_list?: HeychatChannelInfo[];
    [key: string]: unknown;
}

export interface HeychatRoomViewResult {
    room_id?: string;
    room?: HeychatRoomInfo;
    channels?: HeychatChannelInfo[];
    [key: string]: unknown;
}

export interface HeychatApiResponse<T = unknown> {
    status?: string | boolean;
    msg?: string;
    message?: string;
    result?: T;
    data?: T;
    [key: string]: unknown;
}

export interface HeychatApiRequestOptions {
    method?: "GET" | "POST";
    query?: Readonly<Record<string, string | number | boolean | undefined>>;
    body?: unknown;
}

export interface HeychatRoomListResult {
    rooms?: HeychatRoomInfo[];
    total?: number;
    offset?: number;
    limit?: number;
}

export interface HeychatRoomUsersResult {
    room_info?: {
        room_id?: string;
        user_count?: number;
        user_info?: HeychatUserInfo[];
        online_count?: number;
        offline_count?: number;
    };
}
