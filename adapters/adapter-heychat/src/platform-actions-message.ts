import { defineHeychatActionRoutes, type HeychatActionRoute } from "./platform-action-contract.js";
import {
    OPTIONAL_STRING,
    REQUIRED_INTEGER,
    REQUIRED_STRING,
    integerEnum,
} from "./platform-action-rules.js";

const OPTIONAL_MESSAGE_FIELDS = {
    reply_id: OPTIONAL_STRING,
    addition: OPTIONAL_STRING,
    at_user_id: OPTIONAL_STRING,
    at_role_id: OPTIONAL_STRING,
    mention_channel_id: OPTIONAL_STRING,
};

const MESSAGE_ROUTES = {
    send_channel_message: {
        path: "/chatroom/v2/channel_msg/send",
        method: "POST",
        params: {
            msg: REQUIRED_STRING,
            msg_type: REQUIRED_INTEGER,
            heychat_ack_id: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
            channel_id: REQUIRED_STRING,
            channel_type: REQUIRED_INTEGER,
            ...OPTIONAL_MESSAGE_FIELDS,
        },
    },
    send_private_message: {
        path: "/chatroom/v3/msg/user",
        method: "POST",
        params: {
            msg: REQUIRED_STRING,
            msg_type: REQUIRED_INTEGER,
            heychat_ack_id: REQUIRED_STRING,
            to_user_id: REQUIRED_INTEGER,
            addition: OPTIONAL_STRING,
        },
    },
    update_channel_message: {
        path: "/chatroom/v2/channel_msg/update",
        method: "POST",
        params: {
            msg_id: REQUIRED_STRING,
            msg: REQUIRED_STRING,
            msg_type: REQUIRED_INTEGER,
            room_id: REQUIRED_STRING,
            channel_id: REQUIRED_STRING,
            ...OPTIONAL_MESSAGE_FIELDS,
        },
    },
    delete_channel_message: {
        path: "/chatroom/v2/channel_msg/delete",
        method: "POST",
        params: {
            msg_id: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
            channel_id: REQUIRED_STRING,
        },
    },
    set_message_reaction: {
        path: "/chatroom/v2/channel_msg/emoji/reply",
        method: "POST",
        params: {
            msg_id: REQUIRED_STRING,
            emoji: REQUIRED_STRING,
            is_add: integerEnum([0, 1], true),
            channel_id: REQUIRED_STRING,
            room_id: REQUIRED_STRING,
        },
    },
} satisfies Readonly<Record<string, HeychatActionRoute>>;

export const HEYCHAT_MESSAGE_PLATFORM_ACTIONS = defineHeychatActionRoutes(MESSAGE_ROUTES);
