import { defineHeychatActionRoutes, type HeychatActionRoute } from "./platform-action-contract.js";
import { OPTIONAL_STRING, REQUIRED_INTEGER, REQUIRED_STRING } from "./platform-action-rules.js";

const ROOM_ROUTES = {
    list_room_memes: {
        path: "/chatroom/v3/msg/meme/room/list",
        method: "GET",
        params: { room_id: REQUIRED_STRING },
    },
    delete_room_meme: {
        path: "/chatroom/v2/msg/meme/room/del",
        method: "POST",
        params: { path: REQUIRED_STRING, room_id: REQUIRED_STRING },
    },
    update_room_meme: {
        path: "/chatroom/v2/msg/meme/room/edit",
        method: "POST",
        params: { path: REQUIRED_STRING, name: REQUIRED_STRING, room_id: REQUIRED_STRING },
    },
    set_room_nickname: {
        path: "/chatroom/v2/room/nickname",
        method: "POST",
        params: {
            nickname: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
            to_user_id: REQUIRED_INTEGER,
        },
    },
    list_joined_rooms: {
        path: "/chatroom/v2/room/joined",
        method: "GET",
        params: {
            offset: { type: "integer", min: 0 },
            limit: { type: "integer", min: 1, max: 300 },
        },
    },
    get_room: {
        path: "/chatroom/v2/room/view",
        method: "GET",
        params: { room_id: REQUIRED_STRING },
    },
    leave_room: {
        path: "/chatroom/v2/room/leave",
        method: "POST",
        params: { room_id: REQUIRED_STRING },
    },
    kick_room_member: {
        path: "/chatroom/v2/room/kick_out",
        method: "POST",
        params: { room_id: REQUIRED_STRING, to_user_id: REQUIRED_STRING },
    },
    set_room_ban: {
        path: "/chatroom/v2/room/ban",
        method: "POST",
        params: {
            duration: { type: "integer", required: true, min: 0 },
            reason: { ...OPTIONAL_STRING, allowEmpty: true, required: true },
            room_id: REQUIRED_STRING,
            to_user_id: REQUIRED_INTEGER,
        },
    },
    list_room_users: {
        path: "/chatroom/v2/room/users",
        method: "GET",
        params: {
            heybox_id: REQUIRED_STRING,
            offset: { type: "integer", required: true, min: 0 },
            limit: { type: "integer", required: true, min: 1, max: 300 },
            room_id: REQUIRED_STRING,
        },
    },
} satisfies Readonly<Record<string, HeychatActionRoute>>;

export const HEYCHAT_ROOM_PLATFORM_ACTIONS = defineHeychatActionRoutes(ROOM_ROUTES);
