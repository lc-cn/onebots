import { defineKookActionRoutes } from "./platform-action-contract.js";

/** KOOK 语音控制面与机器人在线状态的稳定参数契约。 */
const VOICE_ROUTES = {
    move_voice_user: {
        path: "/v3/channel/move-user",
        method: "POST",
        params: {
            target_id: { type: "string", required: true },
            user_ids: { type: "string_array", required: true, minItems: 1 },
        },
    },
    kick_voice_user: {
        path: "/v3/channel/kickout",
        method: "POST",
        params: {
            channel_id: { type: "string", required: true },
            user_id: { type: "string", required: true },
        },
    },
    get_joined_voice_channel: {
        path: "/v3/channel-user/get-joined-channel",
        method: "GET",
        params: {
            guild_id: { type: "string", required: true },
            user_id: { type: "string", required: true },
            page: { type: "integer", min: 1 },
            page_size: { type: "integer", min: 1, max: 50 },
        },
    },
    join_voice_channel: {
        path: "/v3/voice/join",
        method: "POST",
        params: {
            channel_id: { type: "string", required: true },
            audio_ssrc: { type: "string" },
            audio_pt: { type: "string" },
            rtcp_mux: { type: "boolean" },
            password: { type: "string" },
        },
    },
    list_joined_voice_channels: {
        path: "/v3/voice/list",
        method: "GET",
        params: {},
    },
    leave_voice_channel: {
        path: "/v3/voice/leave",
        method: "POST",
        params: { channel_id: { type: "string", required: true } },
    },
    keep_voice_channel_alive: {
        path: "/v3/voice/keep-alive",
        method: "POST",
        params: { channel_id: { type: "string", required: true } },
    },
    set_bot_online: { path: "/v3/user/online", method: "POST", params: {} },
    set_bot_offline: { path: "/v3/user/offline", method: "POST", params: {} },
    get_bot_online_status: { path: "/v3/user/get-online-status", method: "GET", params: {} },
} as const;

export const KOOK_VOICE_PLATFORM_ACTIONS = defineKookActionRoutes(VOICE_ROUTES);
