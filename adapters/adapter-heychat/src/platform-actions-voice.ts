import { defineHeychatActionRoutes, type HeychatActionRoute } from "./platform-action-contract.js";
import {
    OPTIONAL_INTEGER,
    OPTIONAL_STRING,
    REQUIRED_BOOLEAN,
    REQUIRED_INTEGER,
    REQUIRED_STRING,
} from "./platform-action-rules.js";

const VOICE_ROUTES = {
    move_voice_member: {
        path: "/chatroom/v2/channel/move_member",
        method: "POST",
        params: {
            origin_channel_id: REQUIRED_STRING,
            to_user_ids: { type: "string_array", required: true, minItems: 1 },
            room_id: REQUIRED_STRING,
            channel_id: REQUIRED_STRING,
        },
    },
    kick_voice_member: {
        path: "/chatroom/v2/channel/kick_out",
        method: "POST",
        queryParams: {
            heybox_id: OPTIONAL_STRING,
            room_id: OPTIONAL_STRING,
            channel_id: OPTIONAL_STRING,
        },
        params: { to_user_id: REQUIRED_INTEGER },
    },
    toggle_channel_microphone: {
        path: "/chatroom/v2/channel/mute_user",
        method: "POST",
        params: {
            to_user_id: REQUIRED_INTEGER,
            channel_id: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
        },
    },
    toggle_room_microphone: {
        path: "/chatroom/v2/room/mute",
        method: "POST",
        params: {
            room_id: REQUIRED_STRING,
            mute: REQUIRED_BOOLEAN,
            to_user_id: REQUIRED_INTEGER,
            channel_id: REQUIRED_STRING,
        },
    },
    toggle_room_speaker: {
        path: "/chatroom/v2/room/mute_earphone",
        method: "POST",
        params: {
            room_id: REQUIRED_STRING,
            mute: REQUIRED_BOOLEAN,
            to_user_id: REQUIRED_INTEGER,
            channel_id: REQUIRED_STRING,
        },
    },
    get_user_voice_channel: {
        path: "/chatroom/v2/channel/which_user",
        method: "GET",
        params: {
            to_user_id: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
            must_audio: { type: "boolean" },
        },
    },
    list_voice_channel_members: {
        path: "/chatroom/v2/channel/user/list",
        method: "GET",
        params: {
            channel_id: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
            heybox_id: REQUIRED_STRING,
        },
    },
    create_channel_invite: {
        path: "/chatroom/v2/invite/code",
        method: "GET",
        params: {
            user_id: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
            channel_id: REQUIRED_STRING,
        },
    },
    update_channel_settings: {
        path: "/chatroom/v2/settings/channel/edit",
        method: "POST",
        params: {
            channel_id: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
            setting: REQUIRED_STRING,
            value: REQUIRED_INTEGER,
            channel_type: REQUIRED_INTEGER,
        },
    },
    rename_channel: {
        path: "/chatroom/v2/channel/edit",
        method: "POST",
        params: {
            room_id: REQUIRED_STRING,
            channel_id: REQUIRED_STRING,
            channel_name: REQUIRED_STRING,
            channel_type: REQUIRED_INTEGER,
        },
    },
    set_channel_password: {
        path: "/chatroom/channel/edit_password/no_encrypt",
        method: "POST",
        queryParams: {
            password: { type: "string", required: true, allowEmpty: true },
            channel_id: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
        },
        params: {},
    },
    set_channel_permission: {
        path: "/chatroom/v2/role/role_user_perm",
        method: "POST",
        queryParams: { heybox_id: REQUIRED_STRING },
        params: {
            room_id: REQUIRED_STRING,
            channel_id: REQUIRED_STRING,
            roles: {
                type: "object_array",
                required: true,
                properties: {
                    role_id: REQUIRED_STRING,
                    allow: OPTIONAL_STRING,
                    deny: OPTIONAL_STRING,
                    channel_type: OPTIONAL_INTEGER,
                },
            },
            users: {
                type: "object_array",
                required: true,
                properties: {
                    to_user_id: REQUIRED_INTEGER,
                    allow: OPTIONAL_STRING,
                    deny: OPTIONAL_STRING,
                },
            },
        },
    },
    get_channel_permissions: {
        path: "/chatroom/v2/channel_user_perm/list_with_parent",
        method: "GET",
        params: {
            parent_id: OPTIONAL_STRING,
            channel_id: REQUIRED_STRING,
            to_user_id: REQUIRED_STRING,
        },
    },
    start_voice_stream: {
        path: "/chatroom/v3/channel/stream/push",
        method: "POST",
        params: {
            room_id: REQUIRED_STRING,
            channel_id: REQUIRED_STRING,
            stream_url: REQUIRED_STRING,
            volume: OPTIONAL_INTEGER,
            operator: REQUIRED_INTEGER,
            callback_url: OPTIONAL_STRING,
            seek_second: OPTIONAL_INTEGER,
            repeat_num: OPTIONAL_INTEGER,
            max_duration: OPTIONAL_INTEGER,
        },
    },
    stop_voice_stream: {
        path: "/chatroom/v3/channel/stream/stop",
        method: "POST",
        params: { task_id: REQUIRED_STRING },
    },
} satisfies Readonly<Record<string, HeychatActionRoute>>;

export const HEYCHAT_VOICE_PLATFORM_ACTIONS = defineHeychatActionRoutes(VOICE_ROUTES);
