import { defineHeychatActionRoutes, type HeychatActionRoute } from "./platform-action-contract.js";
import {
    OPTIONAL_INTEGER,
    OPTIONAL_STRING,
    REQUIRED_INTEGER,
    REQUIRED_STRING,
    integerEnum,
} from "./platform-action-rules.js";

const ROLE_ROUTES = {
    list_room_roles: {
        path: "/chatroom/v2/room_role/roles",
        method: "GET",
        params: { room_id: REQUIRED_STRING },
    },
    create_room_role: {
        path: "/chatroom/v2/room_role/create",
        method: "POST",
        params: {
            name: REQUIRED_STRING,
            icon: OPTIONAL_STRING,
            color_list: { type: "integer_array" },
            permissions: REQUIRED_STRING,
            type: REQUIRED_INTEGER,
            color: OPTIONAL_INTEGER,
            hoist: integerEnum([0, 1], true),
            room_id: REQUIRED_STRING,
            nonce: REQUIRED_STRING,
        },
    },
    update_room_role: {
        path: "/chatroom/v2/room_role/update",
        method: "POST",
        params: {
            name: REQUIRED_STRING,
            icon: REQUIRED_STRING,
            id: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
            permissions: REQUIRED_STRING,
            type: REQUIRED_INTEGER,
            color: REQUIRED_INTEGER,
            position: REQUIRED_INTEGER,
            hoist: integerEnum([0, 1], true),
            color_list: { type: "integer_array", required: true },
            nonce: REQUIRED_STRING,
        },
    },
    delete_room_role: {
        path: "/chatroom/v2/room_role/delete",
        method: "POST",
        params: { role_id: REQUIRED_STRING, room_id: REQUIRED_STRING },
    },
    grant_room_role: {
        path: "/chatroom/v2/room_role/grant",
        method: "POST",
        params: {
            to_user_id: REQUIRED_INTEGER,
            role_id: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
        },
    },
    revoke_room_role: {
        path: "/chatroom/v2/room_role/revoke",
        method: "POST",
        params: {
            to_user_id: REQUIRED_INTEGER,
            role_id: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
        },
    },
} satisfies Readonly<Record<string, HeychatActionRoute>>;

export const HEYCHAT_ROLE_PLATFORM_ACTIONS = defineHeychatActionRoutes(ROLE_ROUTES);
